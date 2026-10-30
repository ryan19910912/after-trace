import os,json,time,sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
os.environ['HF_HOME']=str(Path('.test-artifacts/asr-matrix/hf-cache').resolve());os.environ['HF_HUB_DISABLE_PROGRESS_BARS']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
from huggingface_hub import snapshot_download
from faster_whisper import WhisperModel
import librosa
name='WizardForest/faster-whisper-Breeze-ASR-26-int8';revision='5e78fb5aa2ae2bd80cd016949735dedcd050d66e'
print('BREEZE26_DOWNLOAD',flush=True)
path=snapshot_download(name,revision=revision,allow_patterns=['*.json','model.bin','vocabulary.*','*.txt'])
model=WhisperModel(path,device='cpu',compute_type='int8',cpu_threads=4,num_workers=1,local_files_only=True)
results=[]
for s in json.loads(Path('config/local-ai-multilingual-cases.json').read_text(encoding='utf-8')):
    audio,sr=librosa.load(s['file'],sr=16000,mono=True);start=time.monotonic();segments,info=model.transcribe(audio,language='zh',task='transcribe',beam_size=1,vad_filter=False,condition_on_previous_text=False)
    text=''.join(seg.text for seg in segments)
    r={'model':name,'revision':revision,'runtime':'native-ctranslate2-cpu-int8','id':s['id'],'kind':s['kind'],'reference':s['reference'],'mandarinReference':s.get('mandarinReference'),'text':text,'ms':round((time.monotonic()-start)*1000),'seconds':len(audio)/sr};results.append(r);Path('.test-artifacts/asr-matrix/breeze26-native.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print('BREEZE26_RESULT',json.dumps(r,ensure_ascii=False),flush=True)
