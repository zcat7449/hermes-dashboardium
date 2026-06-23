process.env.PORT='0';
process.env.HOST='127.0.0.1';
process.env.DATABASE_URL='';
process.env.PG_IMPORT_FROM_SQLITE='0';
const { listHermesSessions } = require('./server.js');
listHermesSessions('backend').then(s => {
  console.log('sessions:', s.length, s[0]);
}).catch(e => console.error(e));
