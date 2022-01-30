var constants = require('./constants.js');
var crypto = require('crypto');
var fs = require('fs');
var ffmpeg = require('ffmpeg');
var glob = require('glob');
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

function get_clips(clip_ids, callback) {
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

    callback({clips: result});
  });
}

function get_all_clips(callback) {
  __conn.smembers(__all_clip_key, function (err, values) {
    if (err) throw err;
    get_clips(values, callback);
  });
}

function get_tag_clips(tag, callback) {
  var inv_key = `${__tags_inv_key}${tag}`;
  __conn.smembers(inv_key, function (err, values) {
    if (err) throw err;
    get_clips(values, callback);
  });
}

function get_hero_clips(hero, callback) {
  var inv_key = `${__heroes_inv_key}${hero}`;
  __conn.smembers(inv_key, function (err, values) {
    if (err) throw err;
    get_clips(values, callback);
  });
}

function add_clip(src_path, match_id, description, heroes, tags, callback) {
  __conn.incr(__counter_key, function (err, value) {
    if (err) throw err;

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

function save_frame() {
  var pending_pattern = path.join(__dirname, 'public/videos/2be9f74bc4a878424cd18ba34a0ae5fc.mp4');
  glob(pending_pattern, async function (err, files) {
    for (var i = 0; i < files.length; i++) {
      var file_path = files[i];
      var file_name = path.basename(file_path, 'mp4');
      console.log(`Loading ${file_path}`);
      var proc = new ffmpeg(file_path);
      await proc.then(function (video) {
        console.log(`Loaded ${file_path}`);
        var duration = parseInt(video.metadata.duration.seconds);
        video.fnExtractFrameToJPG(
        path.join(__dirname, 'public/video_frames/'), 
          {
            number: 1,
            file_name: `${file_name}`,
            start_time: duration/2.0,
          },
          function (err, files) {
            if (err) throw err;
          });
      }).catch(function (err) {
        console.log(err);
      });
    }
  });
}

load_pending();

module.exports.get_all_clips = get_all_clips;
module.exports.get_clips = get_clips;
module.exports.get_hero_clips = get_hero_clips;
module.exports.get_tag_clips = get_tag_clips;
