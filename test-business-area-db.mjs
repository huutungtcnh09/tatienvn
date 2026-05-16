import mysql from './services/api/node_modules/mysql2/promise/index.js';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'app_kd'
});

try {
  const [rows] = await conn.query('SHOW TABLES LIKE "business_area"');
  console.log('business_area table exists:', rows.length > 0);
  
  if (rows.length > 0) {
    const [cols] = await conn.query('DESC business_area');
    console.log('\nColumns:');
    cols.forEach(c => {
      console.log(`  - ${c.Field} (${c.Type}, ${c.Null === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    const [data] = await conn.query('SELECT COUNT(*) as count FROM business_area');
    console.log('\nRow count:', data[0].count);
  }
} finally {
  await conn.end();
}
