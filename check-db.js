require('dotenv').config();
const mysql = require('mysql2/promise');
(async()=>{
  const db=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});
  const [rows]=await db.query('SELECT DATABASE() AS db, VERSION() AS version');
  const [tables]=await db.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY TABLE_NAME");
  console.log(JSON.stringify({ok:true,database:rows[0].db,version:rows[0].version,tables:tables.map(x=>x.TABLE_NAME)},null,2));
  await db.end();
})().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message},null,2));process.exit(1)});
