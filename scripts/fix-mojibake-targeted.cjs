const fs = require('fs');
const files = [
  'c:/Users/ADMIN/Desktop/APP_KD/apps/store-pos/src/pages/Receipts.jsx',
  'c:/Users/ADMIN/Desktop/APP_KD/apps/store-pos/src/App.jsx',
  'c:/Users/ADMIN/Desktop/APP_KD/apps/store-pos/src/pages/Customers.jsx'
];
const mojibakeRe = /(Ã|á|Ä|Æ|â|âœ|â|â|Â)/;
for (const f of files) {
  let txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split(/\r?\n/);
  const fixed = lines.map((line) => {
    if (!mojibakeRe.test(line)) return line;
    return Buffer.from(line, 'latin1').toString('utf8');
  }).join('\n');
  fs.writeFileSync(f, fixed, 'utf8');
}
console.log('done');
