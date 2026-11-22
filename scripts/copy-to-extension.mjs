import { copyFileSync } from 'node:fs';
copyFileSync('dist/api-pingpong.auto.global.js', 'extension/api-pingpong.auto.global.js');
console.log('copied auto build → extension/');
