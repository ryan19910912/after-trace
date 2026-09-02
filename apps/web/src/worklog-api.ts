export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
export type WorklogRecord = { id:number; sourceId:number; authorUserId:number|null; inputType:WorklogInputType; category:string; rawText:string|null; normalizedSummary:string|null; customerId:number|null; projectId:number|null; sourceTimestamp:string|null; createdAt:string; updatedAt:string };
export type RecordTypeCounts = { TEXT:number; AUDIO:number; IMAGE:number; FILE:number };
export type UserUsage = { userId:number; planCode:string; aiAllowanceUnits:number; aiUsedUnits:number; aiReservedUnits:number; aiRemainingUnits:number; providerCostUsd:number; providerCostTwd:number; records:RecordTypeCounts };
export type GroupMemberUsage = { userId:number; displayName:string|null; recordingEnabled:boolean; aiUsedUnits:number; providerCostUsd:number; providerCostTwd:number; records:RecordTypeCounts; lastInteractionAt:string|null; updatedAt:string };
export type GroupOwnerView = { sourceId:number; ownerUserId:number; owner:UserUsage; groupAiUsedUnits:number; groupProviderCostUsd:number; groupProviderCostTwd:number; members:GroupMemberUsage[] };
export type WorklogSurfaces = { personal:{sourceId:number}|null; groups:Array<{sourceId:number;lineGroupId:string}> };
export type WebEntryContext = {type:'GROUP';lineGroupId:string}|{type:'PRIVATE';userId:number;sourceId:number};
export type EntryExchange = { sessionToken:string; lineUserId:string; entryContext:WebEntryContext };
export type Customer = { id:string; name:string; phone:string|null; address:string|null; note:string|null; created_at:string; updated_at:string };
export type Project = { id:string; customer_id:string|null; customer_name?:string|null; name:string; address:string|null; status:'ACTIVE'|'COMPLETED'|'ARCHIVED'; note:string|null; created_at:string; updated_at:string };
export type Transaction = { id:string; record_id:string|null; customer_id:string|null; project_id:string|null; type:'RECEIVED'|'EXPENSE'|'RECEIVABLE'; amount_twd:string; occurred_at:string; note:string|null; customer_name?:string|null; project_name?:string|null; created_at:string; updated_at:string };

async function json<T>(response:Response,fallback:string):Promise<T&{error?:string}>{const text=await response.text();let body:T&{error?:string};try{body=text?JSON.parse(text) as T&{error?:string}:{} as T&{error?:string};}catch{throw new Error(`${fallback} (${response.status})`);}if(!response.ok)throw new Error(body.error||`${fallback} (${response.status})`);return body;}

export class WorklogApi {
  constructor(private readonly baseUrl:string){}
  private base(path:string){return `${this.baseUrl.replace(/\/$/,'')}${path}`;}
  lineLoginUrl(){return this.base('/api/v1/auth/line/start');}
  async exchangeEntry(token:string){return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),'登入連結驗證失敗');}
  async surfaces(sessionToken:string){return (await json<{surfaces:WorklogSurfaces}>(await this.request(sessionToken,'/api/v1/worklog/surfaces'),'紀錄範圍載入失敗')).surfaces;}
  async personalRecords(sessionToken:string){return (await json<{records:WorklogRecord[]}>(await this.request(sessionToken,'/api/v1/worklog/records/personal'),'個人紀錄載入失敗')).records;}
  async groupRecords(sessionToken:string,sourceId:number){return (await json<{records:WorklogRecord[]}>(await this.request(sessionToken,`/api/v1/worklog/records/group/${sourceId}`),'群組紀錄載入失敗')).records;}
  async myUsage(sessionToken:string){return (await json<{usage:UserUsage}>(await this.request(sessionToken,'/api/v1/worklog/usage/me'),'AI 額度載入失敗')).usage;}
  async ownerView(sessionToken:string,sourceId:number){const response=await this.request(sessionToken,`/api/v1/worklog/groups/${sourceId}/owner-view`);if(response.status===403)return null;return (await json<{ownerView:GroupOwnerView}>(response,'群組管理資料載入失敗')).ownerView;}
  async setRecordingEnabled(sessionToken:string,sourceId:number,memberUserId:number,enabled:boolean){await json(await this.request(sessionToken,`/api/v1/worklog/groups/${sourceId}/members/${memberUserId}/recording`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})}),'成員紀錄權限更新失敗');}
  async customers(sessionToken:string){return (await json<{customers:Customer[]}>(await this.request(sessionToken,'/api/v1/worklog/customers'),'客戶載入失敗')).customers;}
  async createCustomer(sessionToken:string,input:{name:string;phone?:string|null;address?:string|null;note?:string|null}){return (await json<{customer:Customer}>(await this.request(sessionToken,'/api/v1/worklog/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'客戶新增失敗')).customer;}
  async updateCustomer(sessionToken:string,id:string,input:Partial<{name:string;phone:string|null;address:string|null;note:string|null}>){return (await json<{customer:Customer}>(await this.request(sessionToken,`/api/v1/worklog/customers/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'客戶更新失敗')).customer;}
  async projects(sessionToken:string){return (await json<{projects:Project[]}>(await this.request(sessionToken,'/api/v1/worklog/projects'),'專案載入失敗')).projects;}
  async createProject(sessionToken:string,input:{name:string;customerId?:string|null;address?:string|null;status?:Project['status'];note?:string|null}){return (await json<{project:Project}>(await this.request(sessionToken,'/api/v1/worklog/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'專案新增失敗')).project;}
  async updateProject(sessionToken:string,id:string,input:Partial<{name:string;customerId:string|null;address:string|null;status:Project['status'];note:string|null}>){return (await json<{project:Project}>(await this.request(sessionToken,`/api/v1/worklog/projects/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'專案更新失敗')).project;}
  async updateRecord(sessionToken:string,id:number,input:Partial<{customerId:string|null;projectId:string|null;rawText:string|null}>){return (await json<{record:Record<string,unknown>}>(await this.request(sessionToken,`/api/v1/worklog/records/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'紀錄更新失敗')).record;}
  async transactions(sessionToken:string){return (await json<{transactions:Transaction[]}>(await this.request(sessionToken,'/api/v1/worklog/transactions'),'交易載入失敗')).transactions;}
  async createTransaction(sessionToken:string,input:{type:Transaction['type'];amountTwd:string;occurredAt:string;customerId?:string|null;projectId?:string|null;recordId?:number|null;note?:string|null}){return (await json<{transaction:Transaction}>(await this.request(sessionToken,'/api/v1/worklog/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),'交易新增失敗')).transaction;}
  async deleteTransaction(sessionToken:string,id:string){await json(await this.request(sessionToken,`/api/v1/worklog/transactions/${id}`,{method:'DELETE'}),'交易刪除失敗');}
  private request(sessionToken:string,path:string,init?:RequestInit){const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${sessionToken}`);return fetch(this.base(path),{...init,headers});}
}
