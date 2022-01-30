var constants = require('../constants.js');
var db = require('../db.js');
var express = require('express');
var router = express.Router();

/*
 * GET all clip IDs
 */
router.get('/clips', function(req, res, next) {
  res.json([1, 2, 3, 4]);
});

/*
 * GET info for a specific clip ID
 */
router.get('/clip/:id', function(req, res, next) {
  res.json(db.clip_info(req.params.id));
});

/*
 * GET all heroes
 */
router.get('/heroes', function(req, res, next) {
  res.json(constants.heroes);
});

/*
 * GET all clip tags
 */
router.get('/tags', function(req, res, next) {
  res.json(constants.tags);
})

module.exports = router;
