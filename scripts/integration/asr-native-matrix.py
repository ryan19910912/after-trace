import os,json,time,gc,traceback,sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
from pathlib import Path
os.environ['HF_HOME']=str(Path('.test-artifacts/asr-matrix/hf-cache').resolve())
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['HF_HUB_DISABLE_PROGRESS_BARS']='1'
os.environ['TOKENIZERS_PARALLELISM']='false'
import torch,librosa
from huggingface_hub import snapshot_download
from qwen_asr import Qwen3ASRModel
torch.set_num_threads(8)
samples=json.loads(Path('config/local-ai-multilingual-cases.json').read_text(encoding='utf-8'))
models=['JacobLinCool/TEA-ASR-1.1-mini','JacobLinCool/TEA-ASR-1.1','Qwen/Qwen3-ASR-0.6B','Qwen/Qwen3-ASR-1.7B']
models=[m for m in models if not os.environ.get('ASR_NATIVE_MODEL') or os.environ['ASR_NATIVE_MODEL'] in m]
results=[]
for name in models:
    meta=json.loads(Path('.test-artifacts/asr-matrix/'+name.replace('/','--')+'.json').read_text(encoding='utf-8'))
    model=None
    try:
        print('NATIVE_DOWNLOAD',name,flush=True)
        path=snapshot_download(name,revision=meta['sha'],allow_patterns=['*.json','*.safetensors','*.txt','*.tiktoken','*.jinja'])
        started=time.monotonic()
        model=Qwen3ASRModel.from_pretrained(path,dtype=torch.float32,device_map='cpu',max_inference_batch_size=1,max_new_tokens=160)
        print('NATIVE_LOADED',name,round(time.monotonic()-started,2),flush=True)
        for sample in samples:
            audio,sr=librosa.load(sample['file'],sr=16000,mono=True)
            begin=time.monotonic()
            output=model.transcribe(audio=(audio,sr),language='Chinese')[0]
            row={'model':name,'revision':meta['sha'],'runtime':'native-python-cpu-fp32','id':sample['id'],'kind':sample['kind'],'text':output.text,'language':output.language,'seconds':len(audio)/sr,'ms':round((time.monotonic()-begin)*1000),'reference':sample['reference'],'mandarinReference':sample.get('mandarinReference')}
            results.append(row)
            Path('.test-artifacts/asr-matrix/native-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
            print('NATIVE_RESULT',json.dumps(row,ensure_ascii=False),flush=True)
    except Exception as error:
        print('NATIVE_ERROR',name,repr(error),traceback.format_exc(),flush=True)
        results.append({'model':name,'error':str(error),'runtime':'native-python-cpu-fp32'})
        Path('.test-artifacts/asr-matrix/native-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        del model
        gc.collect()
