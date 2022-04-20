var constants = require('./constants.js');
var crypto = require('crypto');
var fs = require('fs');
var ffmpeg = require('ffmpeg');
var glob = require('glob');
var https = require('https');
var path = require('path');
var redis = require('redis');

const __select_db = 1;

const __counter_key = 'clip_counter';
const __all_clip_key = 'clips';
const __clip_key = 'clip_';
const __heroes_key = 'heroes_';
const __heroes_inv_key = 'hero_';
const __tags_key = 'tags_';
const __tags_inv_key = 'tag_';

var __conn = redis.createClient({db: __select_db});

function hero_list(hero_ids) {
  return hero_ids.map(
    hero_id => [String(hero_id).padStart(3, '0'), constants.heroes[hero_id]]
  );
}

function clip_hash(match_id, extra_id) {
  var full_id = String(match_id) + String(extra_id);
  return crypto.createHash('md5').update(full_id).digest('hex');
}

function clip_time(duration) {
  var minutes = Math.floor(duration / 60);
  var seconds = duration - minutes*60;
  return String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0');
}

function start_time(timestamp) {
  var date = new Date(timestamp*1000);
  return date.toDateString();
}

function get_clips(clip_ids, include_headers, callback) {
  var multi = __conn.multi();

  clip_ids.forEach(function (clip) {
    var hash_key = `${__clip_key}${clip}`;
    var hero_key = `${__heroes_key}${clip}`;
    var tag_key = `${__tags_key}${clip}`;

    multi.hgetall(hash_key);
    multi.lrange(hero_key, 0, -1);
    multi.lrange(tag_key, 0, -1);
  });

  multi.exec(function (err, replies) {
    if (err) throw err;

    var result = [];
    for (var i = 0; i < replies.length; i += 3) {
      if (!replies[i])
        continue;

      result.push({
        clip: clip_ids[i/3],
        match: replies[i].match_id,
        description: replies[i].description,
        duration: clip_time(replies[i].duration),
        start_time: start_time(replies[i].start_time),
        time_stamp: replies[i].start_time,
        heroes: hero_list(replies[i+1]),
        tags: replies[i+2].sort(),
      });
    }

    result.sort(function (a, b) {
      if (a.match < b.match)
        return 1;
      else if (a.match > b.match)
        return -1;
      if (a.duration < b.duration)
        return 1
      else if (a.duration > b.duration)
        return -1;
      return 0;
    });

    var final_result = [];
    var last_month = -1;

    for (var i = 0; i < result.length; i++) {
      if (include_headers) {
        var date = new Date(result[i].time_stamp*1000);
        if (date.getMonth() != last_month)
        {
          last_month = date.getMonth();
          var month_name = date.toLocaleString('default', { month: 'short' });
          var year = date.getFullYear();

          final_result.push({
            clip: 0,
            start_time: `${month_name} ${year}`,
          });
        }
      }

      final_result.push(result[i]);
    }

    callback({clips: final_result});
  });
}

function get_all_clips(callback) {
  __conn.smembers(__all_clip_key, function (err, values) {
    if (err) throw err;
    get_clips(values, true, callback);
  });
}

function get_tag_clips(tag, callback) {
  var inv_key = `${__tags_inv_key}${tag}`;
  __conn.smembers(inv_key, function (err, values) {
    if (err) throw err;
    get_clips(values, true, callback);
  });
}

function get_hero_clips(hero, callback) {
  var inv_key = `${__heroes_inv_key}${hero}`;
  __conn.smembers(inv_key, function (err, values) {
    if (err) throw err;
    get_clips(values, true, callback);
  });
}

function get_match_time(match_id, callback) {
  var options = {
    hostname: 'api.opendota.com',
    port: 443,
    path: `/api/matches/${match_id}`,
    method: 'GET',
  };

  var req = https.request(options, function (res) {
    res.setEncoding('utf8');

    var json_body = '';
    res.on('data', function (chunk) {
      json_body += chunk;
    });

    res.on('end', function () {
      var json_data = JSON.parse(json_body);
      callback(json_data.start_time);
    });
  });

  req.on('error', function (e) {
    console.log('Problem with OpenDota API request: ' + e.message);
    callback(0);
  });

  req.end();
}

function add_clip(src_path, match_id, description, heroes, tags, callback) {
  __conn.incr(__counter_key, function (err, value) {
    if (err) throw err;

    get_match_time(match_id, function (start_time) {
      var hash = clip_hash(match_id, value);
      console.log(`Adding clip with hash=${hash}`);
      var dst_path = path.join(__dirname, 'public/videos/' + String(hash) + '.mp4');

      fs.copyFile(src_path, dst_path, fs.constants.COPYFILE_EXCL, function (err) {
        if (err) throw err;

        var proc = new ffmpeg(src_path);
        proc.then(function (video) {
          var duration = parseInt(video.metadata.duration.seconds);
          var multi = __conn.multi();

          var hash_key = `${__clip_key}${hash}`;
          var hero_key = `${__heroes_key}${hash}`;
          var tag_key = `${__tags_key}${hash}`;

          multi.del(hash_key);
          multi.del(hero_key);
          multi.del(tag_key);

          multi.hset(hash_key, "match_id", match_id);
          multi.hset(hash_key, "description", description);
          multi.hset(hash_key, "duration", duration);
          multi.hset(hash_key, "start_time", start_time);
          multi.sadd(__all_clip_key, hash);

          var frame_name = path.basename(dst_path, 'mp4');
          video.fnExtractFrameToJPG(
            path.join(__dirname, 'public/video_frames/'), 
            {
              number: 1,
              file_name: `${frame_name}`,
              start_time: duration/2.0,
            },
            function (err, files) {
              if (err) throw err;
            }
          );

          heroes.forEach(function (element) {
            multi.rpush(hero_key, element);
            var inv_key = `${__heroes_inv_key}${element}`;
            multi.sadd(inv_key, hash);
          });

          tags.forEach(function (element) {
            multi.rpush(tag_key, element);
            var final_tag = element.replace(' ', '-');
            var inv_key = `${__tags_inv_key}${final_tag}`;
            multi.sadd(inv_key, hash);
          });

          multi.exec(function (err, replies) {
            if (err) throw err;
            callback(hash);
          });
        });
      });
    });
  });
}

function load_pending() {
  var pending_pattern = path.join(__dirname, 'pending/*.txt');
  glob(pending_pattern, function (err, files) {
      files.forEach(function (element) {
        var components = element.split('.');
        var path = components[0].split('/');
        fs.readFile(element, 'utf8', function (err, data) {
          var lines = data.split('\n');
          var heroes = lines[0].split(',').map(function(hero) {
            return parseInt(hero, 10);
          });
          var tags = lines[1].split(',').map(function(tag) {
            return tag.trim();
          });
          var description = lines[2];

          var error = false;
          heroes.forEach(function (hero) {
            if (!(hero in constants.heroes)) {
              console.log(`Invalid hero '${hero}'`);
              error = true;
            }
          });
          tags.forEach(function (tag) {
            if (!constants.tags.includes(tag)) {
              console.log(`Invalid tag '${tag}'`);
              error = true;
            }
          });

          if (!error) {
            var mp4 = element.replace('.txt', '.mp4');
            add_clip(mp4, path[path.length-1], description, heroes, tags, function (hash) {
              console.log(`Added clip '${mp4}' as '${hash}'`);
            });
          }
        });
      });
  });
}

function update_times() {
  __conn.smembers(__all_clip_key, function (err, values) {
    if (err) throw err;
    values.forEach(function (clip) {
      var hash_key = `${__clip_key}${clip}`;
      __conn.hgetall(hash_key, function (err, values) {
        if (values.start_time)
          return;
        console.log(`Fetching time for ${values.match_id}`);
        setTimeout(function () {
          get_match_time(values.match_id, function (start_time) {
            __conn.hset(hash_key, "start_time", start_time, function (err) {
              console.log(`Set time for ${hash_key} ${start_time}`);
            });
          });
        }, 1500);
      });
    });
  });
}

load_pending();

module.exports.get_all_clips = get_all_clips;
module.exports.get_clips = get_clips;
module.exports.get_hero_clips = get_hero_clips;
module.exports.get_tag_clips = get_tag_clips;
