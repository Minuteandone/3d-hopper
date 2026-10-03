import { loadHopperRom } from './rom.js';
import { textureMapFromRom, decodeTexture } from './cgfx.js';
import { modelMapFromRom } from './models.js';
import { liftHopperProgram } from './executable.js';
import { HopperGame } from './game.js';
import { HopperAudio } from './audio.js';

const $=s=>document.querySelector(s);
const boot=$('#boot'),titleScreen=$('#titleScreen'),finish=$('#finish'),thanks=$('#thanks'),errorBox=$('#error');
const hud=$('#hud'),touch=$('#touchControls'),status=$('#romStatus'),audioToggle=$('#audioToggle');
let rom=null,assets=null,models=null,program=null,game=null,audio=null,nextStage=0,muted=false;

function show(el,on=true){el.classList.toggle('hidden',!on);}
function fail(err){console.error(err);errorBox.textContent=err instanceof Error?err.message:String(err);show(errorBox,true);setTimeout(()=>show(errorBox,false),8000);}
function drawTexture(canvas,tex,fit='contain'){
  const d=decodeTexture(tex);canvas.width=d.width;canvas.height=d.height;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,d.width,d.height);ctx.putImageData(new ImageData(d.data,d.width,d.height),0,0);canvas.style.objectFit=fit;
}
function drawThanks(){const tex=assets.get('thank_youU')||assets.get('thank_youD');if(tex)drawTexture($('#thanksArt'),tex);}
function fillArt(){for(const [sel,name] of [['#titleArt','title'],['#pressArt','press_a'],['#congratsArt','congratulations']]){const t=assets.get(name);if(t)drawTexture($(sel),t);}drawThanks();}
function updateAudioButton(){audioToggle.textContent=muted?'🔇 Audio off':'🔊 ROM audio';audioToggle.setAttribute('aria-pressed',String(muted));}

async function openRom(file){
  try{
    show(errorBox,false);status.textContent='Reading prototype filesystem + executable…';audio?.stop();
    rom=await loadHopperRom(file);
    program=liftHopperProgram(rom);
    status.textContent=`ARM build verified · ${rom.files.size} files · translating assets…`;
    await new Promise(r=>requestAnimationFrame(r));
    assets=textureMapFromRom(rom);models=modelMapFromRom(rom);
    if(assets.size<10)throw new Error(`ROM loaded, but only ${assets.size} textures decoded. Is this the E3 2010 3D Hopper build?`);
    if(!models.has('neko_hopping_model')||!models.has('hopper_floor01_model')||!models.has('hopper_floor02_model'))throw new Error('Original Hopper BCMDL models could not be decoded from this ROM.');
    audio=new HopperAudio(rom);audio.setMuted(muted);fillArt();
    game?.renderer?.setAnimationLoop(null);$('#viewport').replaceChildren();
    game=new HopperGame($('#viewport'),assets,models,program,{
      onStage:(n,meta)=>{
        $('#stageNo').textContent=n;$('#falls').textContent=game?.state?.falls??0;
        if(n===3&&meta.rescueCounter===0)status.textContent='Original Stage 3 rescue platform is gone (ARM counter reached 0).';
      },
      onTime:t=>$('#time').textContent=t.toFixed(1),
      onFalls:(n,meta)=>{
        $('#falls').textContent=n;
        if(meta.rebuild)status.textContent=`Original Stage 3 rescue counter: ${meta.rescueCounter}`;
      },
      onWin:stats=>{
        audio?.playCongrats();nextStage=stats.final?0:stats.stageIndex+1;
        $('#againButton').textContent=stats.final?'Play from Stage 1':'Next original stage';
        $('#finishStats').textContent=`Stage ${stats.stage}/4 · ${stats.time.toFixed(1)} seconds · ${stats.falls} fall${stats.falls===1?'':'s'} · layout translated from ARM`;
        show(hud,false);show(touch,false);show(finish,true);
      }
    });
    game.bindTouch(touch);game.setDepth(+$('#depth').value/100);
    const audioCount=['sound/stream/DUMMY_LOOPED.bcstm','sound/stream/HOPPER_BGM_CONGRATS.bcstm'].filter(p=>rom.has(p)).length;
    status.textContent=`Ready · 4 original stages · ${models.size} BCMDL models · ${assets.size} textures · ${audioCount} audio streams · ARM runtime translated`;
    show(boot,false);show(finish,false);show(thanks,false);show(titleScreen,true);
  }catch(e){status.textContent='ROM/code lift failed';fail(e);}
}

for(const input of [$('#romInput'),$('#romInputBig')])input.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)openRom(f);});

function start(stage=0){
  if(!game)return;try{audio?.playBgm();}catch(e){console.warn('ROM audio unavailable',e);}
  show(titleScreen,false);show(finish,false);show(thanks,false);show(hud,true);show(touch,true);$('#falls').textContent=stage===0?'0':String(game.state.falls);game.start(stage);
}

$('#startButton').addEventListener('click',()=>start(0));
$('#againButton').addEventListener('click',()=>start(nextStage));
$('#thanksButton').addEventListener('click',()=>{show(finish,false);show(thanks,true);drawThanks();});
$('#backButton').addEventListener('click',()=>{audio?.stop();show(thanks,false);show(titleScreen,true);game?.pause();});
$('#depth').addEventListener('input',e=>game?.setDepth(+e.target.value/100));
audioToggle.addEventListener('click',()=>{muted=!muted;audio?.setMuted(muted);updateAudioButton();if(!muted&&game?.playing){try{audio?.playBgm();}catch(e){console.warn('ROM audio unavailable',e);}}});
updateAudioButton();
addEventListener('keydown',e=>{if((e.code==='Enter'||e.code==='Space')&&!titleScreen.classList.contains('hidden')){e.preventDefault();start(0);}});
