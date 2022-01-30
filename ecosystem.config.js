module.exports = {
  apps : [{
    name: "dota.taylorpetrick.com",
    script: "./app.js",
    env_production: {
      NODE_ENV: "production"
    },
    env: {
      NODE_ENV: "development"
    }
  }]
};
