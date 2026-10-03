import { loadHopperRom } from './rom.js';
import { textureMapFromRom, decodeTexture } from './cgfx.js';
import { HopperGame } from './game.js';

const $=s=>document.querySelector(s);
const boot=$('#boot'), titleScreen=$('#titleScreen'), finish=$('#finish'), thanks=$('#thanks'), errorBox=$('#error');
const hud=$('#hud'), touch=$('#touchControls'), status=$('#romStatus');
let rom=null,assets=null,game=null,nextStage=0;

function show(el,on=true){el.classList.toggle('hidden',!on);}
function fail(err){console.error(err);errorBox.textContent=err instanceof Error?err.message:String(err);show(errorBox,true);setTimeout(()=>show(errorBox,false),8000);}
function drawTexture(canvas,tex,fit='contain'){
  const d=decodeTexture(tex);canvas.width=d.width;canvas.height=d.height;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,d.width,d.height);ctx.putImageData(new ImageData(d.data,d.width,d.height),0,0);
  canvas.style.objectFit=fit;
}
function drawThanks(){
  const tex=assets.get('thank_youU')||assets.get('thank_youD');if(tex)drawTexture($('#thanksArt'),tex);
}
function fillArt(){
  const pairs=[['#titleArt','title'],['#pressArt','press_a'],['#congratsArt','congratulations']];
  for(const [sel,name] of pairs){const t=assets.get(name);if(t)drawTexture($(sel),t);}
  drawThanks();
}

async function openRom(file){
  try{
    show(errorBox,false);status.textContent='Reading prototype filesystem…';
    rom=await loadHopperRom(file);
    status.textContent=`ROFS found · ${rom.files.size} files · decoding CGFX…`;
    await new Promise(r=>requestAnimationFrame(r));
    assets=textureMapFromRom(rom);
    if(assets.size<10)throw new Error(`ROM loaded, but only ${assets.size} textures decoded. Is this the E3 2010 3D Hopper build?`);
    fillArt();
    game?.renderer?.setAnimationLoop(null);$('#viewport').replaceChildren();
    game=new HopperGame($('#viewport'),assets,{
      onStage:n=>$('#stageNo').textContent=n,
      onTime:t=>$('#time').textContent=t.toFixed(1),
      onFalls:n=>$('#falls').textContent=n,
      onWin:stats=>{
        nextStage=stats.stage%2;
        $('#againButton').textContent=nextStage?'Next stage':'Play again';
        $('#finishStats').textContent=`Stage ${stats.stage} · ${stats.time.toFixed(1)} seconds · ${stats.falls} fall${stats.falls===1?'':'s'}`;
        show(hud,false);show(touch,false);show(finish,true);
      }
    });
    game.bindTouch(touch);game.setDepth(+$('#depth').value/100);
    status.textContent=`Ready · ${rom.files.size} ROM files · ${assets.size} original textures decoded locally`;
    show(boot,false);show(finish,false);show(thanks,false);show(titleScreen,true);
  }catch(e){status.textContent='ROM load failed';fail(e);}
}

for(const input of [$('#romInput'),$('#romInputBig')])input.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)openRom(f);});

function start(stage=0){
  if(!game)return;show(titleScreen,false);show(finish,false);show(thanks,false);show(hud,true);show(touch,true);$('#falls').textContent='0';game.start(stage);
}

$('#startButton').addEventListener('click',()=>start(0));
$('#againButton').addEventListener('click',()=>start(nextStage));
$('#thanksButton').addEventListener('click',()=>{show(finish,false);show(thanks,true);drawThanks();});
$('#backButton').addEventListener('click',()=>{show(thanks,false);show(titleScreen,true);game?.pause();});
$('#depth').addEventListener('input',e=>game?.setDepth(+e.target.value/100));
addEventListener('keydown',e=>{if((e.code==='Enter'||e.code==='Space')&&!titleScreen.classList.contains('hidden')){e.preventDefault();start(0);}});
