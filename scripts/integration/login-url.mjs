import {readFileSync} from 'node:fs';
const {owner}=JSON.parse(readFileSync('.test-artifacts/integration-session.json','utf8'));
console.log('http://localhost:15173/#session='+encodeURIComponent(owner.token));
