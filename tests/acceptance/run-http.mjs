import {spawn}from 'node:child_process';
const server=spawn(process.execPath,['tests/acceptance/server.mjs'],{stdio:['ignore','pipe','inherit']});
let started=false;const timeout=setTimeout(()=>{server.kill();process.exitCode=1;},15000);
server.stdout.on('data',data=>{if(started||!data.toString().includes('Synthetic HEC acceptance:'))return;started=true;const check=spawn(process.execPath,['tests/acceptance/http-check.mjs'],{stdio:'inherit'});check.on('exit',code=>{clearTimeout(timeout);server.kill();process.exitCode=code||0;});});
server.on('exit',()=>{if(!started){clearTimeout(timeout);process.exitCode=1;}});
