var create_error = require('http-errors');
var express = require('express');
var http = require('http');
var logger = require('morgan');
var path = require('path');
var stylus = require('stylus');

var index_router = require('./routes/index');
var api_router = require('./routes/api');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(stylus.middleware(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index_router);
app.use('/api', api_router);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(create_error(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// create server
var server = http.createServer(app);
server.listen(3003);
