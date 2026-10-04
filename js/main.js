import { loadHopperRom } from './rom.js';
import { textureMapFromRom, decodeTexture } from './cgfx.js';
import { modelMapFromRom } from './models.js';
import { skeletalAnimationMapFromRom } from './animation.js';
import { emitterMapFromRom } from './emitters.js';
import { liftHopperProgram } from './executable.js';
import { HopperGame } from './game.js';
import { bcsarFromRom } from './bcsar.js';
import { fragmentLightMapFromRom } from './lights.js';
import { prototypeLutMapFromRom } from './luts.js';

const $=s=>document.querySelector(s);
const boot=$('#boot'),titleScreen=$('#titleScreen'),thanks=$('#thanks'),errorBox=$('#error');
const touch=$('#touchControls'),status=$('#romStatus');
let rom=null,assets=null,models=null,animations=null,emitters=null,soundCatalog=null,fragmentLights=null,luts=null,program=null,game=null;

function show(el,on=true){el.classList.toggle('hidden',!on);}
function fail(err){console.error(err);errorBox.textContent=err instanceof Error?err.message:String(err);show(errorBox,true);setTimeout(()=>show(errorBox,false),8000);}
function drawTexture(canvas,tex,fit='contain'){
  const d=decodeTexture(tex);canvas.width=d.width;canvas.height=d.height;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,d.width,d.height);ctx.putImageData(new ImageData(d.data,d.width,d.height),0,0);canvas.style.objectFit=fit;
}
function drawThanks(){const tex=assets.get('thank_youU')||assets.get('thank_youD');if(tex)drawTexture($('#thanksArt'),tex);}
function fillArt(){for(const [sel,name] of [['#titleArt','title'],['#pressArt','press_a']]){const t=assets.get(name);if(t)drawTexture($(sel),t);}drawThanks();}

async function openRom(file){
  try{
    show(errorBox,false);status.textContent='Reading prototype filesystem + executable…';
    rom=await loadHopperRom(file);
    program=liftHopperProgram(rom);
    status.textContent=`ARM build verified · ${rom.files.size} files · translating assets…`;
    await new Promise(r=>requestAnimationFrame(r));
    assets=textureMapFromRom(rom);models=modelMapFromRom(rom);animations=skeletalAnimationMapFromRom(rom);emitters=emitterMapFromRom(rom);soundCatalog=bcsarFromRom(rom);fragmentLights=fragmentLightMapFromRom(rom);luts=prototypeLutMapFromRom(rom);
    if(assets.size<10)throw new Error(`ROM loaded, but only ${assets.size} textures decoded. Is this the E3 2010 3D Hopper build?`);
    if(!models.has('neko_hopping_model')||!models.has('hopper_floor01_model')||!models.has('hopper_floor02_model'))throw new Error('Original Hopper BCMDL models could not be decoded from this ROM.');
    if(!animations.has('neko_hopping_jump'))throw new Error('Original neko_hopping_jump CANM clip could not be decoded from this ROM.');
    fillArt();
    game?.renderer?.setAnimationLoop(null);$('#viewport').replaceChildren();
    game=new HopperGame($('#viewport'),assets,models,animations,{fragmentLights,luts},program,{
      onStage:(n,meta)=>{
        if(n===3&&meta.rescueCounter===0)status.textContent='Original Stage 3 rescue platform is gone (ARM counter reached 0).';
      },
      onFalls:(n,meta)=>{
        if(meta.rebuild)status.textContent=`Original Stage 3 rescue counter: ${meta.rescueCounter}`;
      },
      onEndingStart:()=>{
        status.textContent='Final goal · native state 3 ending sequence';
      },
      onEndingEvent:event=>{
        if(event.type==='starshower')status.textContent='Ending frame 240 · original starshower00 trigger reached';
      },
      onThanks:info=>{
        show(touch,false);show(titleScreen,false);show(thanks,true);drawThanks();
        status.textContent=`Native state 5 targets ${info.scene}; original global fade (argument ${info.fadeArgument}) is not yet translated`;
      }
    });
    game.bindTouch(touch);
    status.textContent=`Ready · 4 descriptor stages · ${models.size} BCMDL models · ${animations.size} CANM clip · ${emitters.size} PEMT emitters · ${assets.size} textures · ${fragmentLights.size} fragment light · ${luts.size} LUT resources · ${soundCatalog.sounds.length} BCSAR sounds · gameplay translation incomplete`;
    show(boot,false);show(thanks,false);show(titleScreen,true);
  }catch(e){status.textContent='ROM/code lift failed';fail(e);}
}

for(const input of [$('#romInput'),$('#romInputBig')])input.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)openRom(f);});

function start(stage=0){
  if(!game)return;
  show(titleScreen,false);show(thanks,false);show(touch,true);game.start(stage);
}

$('#startButton').addEventListener('click',()=>start(0));
$('#backButton').addEventListener('click',()=>{show(thanks,false);show(titleScreen,true);game?.pause();});
addEventListener('keydown',e=>{if((e.code==='Enter'||e.code==='Space')&&!titleScreen.classList.contains('hidden')){e.preventDefault();start(0);}});
