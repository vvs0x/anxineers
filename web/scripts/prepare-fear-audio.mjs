import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const output=new URL('../public/audio/fear/',import.meta.url);await mkdir(output,{recursive:true});
for(const [source,name] of [['Wind.m4a','wind'],['Things moving.m4a','movement']]){
 execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',fileURLToPath(new URL('../../../'+source,import.meta.url)),
 '-af','loudnorm=I=-24:TP=-6:LRA=9,afade=t=in:d=0.5,areverse,afade=t=in:d=0.5,areverse',
 '-ar','44100','-codec:a','libmp3lame','-b:a','128k',fileURLToPath(new URL(name+'.mp3',output))],{stdio:'inherit'});
}
console.log('Prepared the supplied Wind and Things moving recordings.');
