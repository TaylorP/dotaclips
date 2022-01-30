var constants = require('../constants.js');
var db = require('../db.js');
var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  db.get_all_clips(function (clips) {
    var page_args = clips;
    page_args.title = 'Dota Clips';
    page_args.url = 'https://dota.taylorpetrick.com';
    page_args.image = 'https://dota.taylorpetrick.com/images/favicon.png'
    page_args.description = 'Dota 2 replays and clips';
    res.render('clips', page_args);
  });
});

/* GET a clip by id */
router.get('/clip/:id', function(req, res, next) {
  db.get_clips([req.params.id], function (info) {
    if (!info || (info.length == 0)) {
      next();
    } else {
      var page_args = info['clips'][0];
      page_args.title = 'Dota Clips';
      page_args.video = `https://dota.taylorpetrick.com/videos/${page_args.clip}.mp4`
      page_args.image = `https://dota.taylorpetrick.com/video_frames/${page_args.clip}_1.jpg`
      page_args.url = page_args.video;
      res.render('clip', page_args);
    }
  });
});

/* GET clips by tag */
router.get('/tag/:tag', function (req, res, next) {
  db.get_tag_clips(req.params.tag, function (clips) {
    var page_args = clips;
    page_args.tag = req.params.tag;
    page_args.url = `https://dota.taylorpetrick.com/tag/${req.params.tag}`;
    page_args.image = 'https://dota.taylorpetrick.com/images/favicon.png'
    page_args.description = `Dota clips tagged with '${req.params.tag}'`;
    res.render('clips', page_args);
  });
});

/* GET clips by hero */
router.get('/hero/:hero', function (req, res, next) {
  var hero_id = parseInt(req.params.hero);
  if (!(hero_id in constants.heroes)) {
    next();
    return;
  }

  db.get_hero_clips(hero_id, function (clips) {
    var page_args = clips;
    page_args.hero_id = String(hero_id).padStart(3, '0');
    page_args.hero_name = constants.heroes[hero_id];
    page_args.title = `${page_args.hero_name} Clips`;
    page_args.description = `Dota clips for the hero '${page_args.hero_name}'`;
    res.render('clips', page_args);
  });
});

module.exports = router;
