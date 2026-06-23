process.env.PORT='0';
process.env.HOST='127.0.0.1';
process.env.DATABASE_URL='';
process.env.PG_IMPORT_FROM_SQLITE='0';
const config = require('./config.js');
console.log('PROFILES_DIR:', config.PROFILES_DIR);
console.log('exists backend:', require('fs').existsSync(config.PROFILES_DIR + '/backend'));
