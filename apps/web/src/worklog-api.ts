export type WorklogInputType = 'TEXT' | 'AUDIO' | 'IMAGE' | 'FILE';
export type WorklogCategory = 'NOTE' | 'WORK' | 'ISSUE' | 'PAYMENT' | 'EXPENSE' | 'MATERIAL' | 'PHOTO' | 'AUDIO' | 'OTHER';

export type WorklogRecord = {
  id: number;
  sourceId: number;
  authorUserId: number | null;
  inputType: WorklogInputType;
  category: WorklogCategory;
  rawText: string | null;
  normalizedSummary: string | null;
  customerId: number | null;
  customerName: string | null;
  projectId: number | null;
  projectName: string | null;
  sourceTimestamp: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecordPage = { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
export type RecordFilters = {
  query?: string;
  inputType?: '' | WorklogInputType;
  category?: '' | WorklogCategory;
  customerId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};
export type RecordTypeCounts = { TEXT:number; AUDIO:number; IMAGE:number; FILE:number };
export type UserUsage = { userId:number; planCode:string; aiAllowanceUnits:number; aiUsedUnits:number; aiReservedUnits:number; aiRemainingUnits:number; providerCostUsd:number; providerCostTwd:number; records:RecordTypeCounts };
export type GroupMemberUsage = { userId:number; displayName:string|null; recordingEnabled:boolean; aiUsedUnits:number; providerCostUsd:number; providerCostTwd:number; records:RecordTypeCounts; lastInteractionAt:string|null; updatedAt:string };
export type GroupOwnerView = { sourceId:number; ownerUserId:number; owner:UserUsage; groupAiUsedUnits:number; groupProviderCostUsd:number; groupProviderCostTwd:number; members:GroupMemberUsage[] };
export type WorklogSurfaces = { personal:{sourceId:number}|null; groups:Array<{sourceId:number;lineGroupId:string}> };
export type WebEntryContext = {type:'GROUP';lineGroupId:string}|{type:'PRIVATE';userId:number;sourceId:number};
export type EntryExchange = { sessionToken:string; lineUserId:string; entryContext:WebEntryContext };

export type Customer = {
  id:string; name:string; phone:string|null; address:string|null; note:string|null;
  project_count?:string; record_count?:string; created_at:string; updated_at:string;
};
export type Project = {
  id:string; customer_id:string|null; customer_name:string|null; name:string; address:string|null;
  status:'ACTIVE'|'COMPLETED'|'ARCHIVED'; note:string|null; record_count?:string;
  received_twd?:string; expense_twd?:string; receivable_twd?:string; created_at:string; updated_at:string;
};
export type Transaction = {
  id:string; record_id:string|null; customer_id:string|null; customer_name:string|null;
  project_id:string|null; project_name:string|null; type:'RECEIVED'|'EXPENSE'|'RECEIVABLE';
  amount_twd:string; occurred_at:string; note:string|null; created_at:string; updated_at:string;
};

async function json<T>(response:Response,fallback:string):Promise<T&{error?:string}>{
  const text=await response.text(); let body:T&{error?:string};
  try{body=text?JSON.parse(text) as T&{error?:string}:{} as T&{error?:string};}
  catch{throw new Error(`${fallback} (${response.status})`);}
  if(!response.ok)throw new Error(body.error||`${fallback} (${response.status})`); return body;
}

export class WorklogApi {
  constructor(private readonly baseUrl:string){}
  private base(path:string){return `${this.baseUrl.replace(/\/$/,'')}${path}`;}
  lineLoginUrl(){return this.base('/api/v1/auth/line/start');}

  async exchangeEntry(token:string){return json<EntryExchange>(await fetch(this.base('/api/v1/auth/entry/exchange'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}),'登入連結驗證失敗');}
  async surfaces(sessionToken:string){return (await json<{surfaces:WorklogSurfaces}>(await this.request(sessionToken,'/api/v1/worklog/surfaces'),'紀錄範圍載入失敗')).surfaces;}

  async personalRecords(sessionToken:string,filters:RecordFilters={}):Promise<{records:WorklogRecord[];page:RecordPage}>{
    return this.recordPage(sessionToken,'/api/v1/worklog/records/personal',filters,'個人紀錄載入失敗');
  }
  async groupRecords(sessionToken:string,sourceId:number,filters:RecordFilters={}):Promise<{records:WorklogRecord[];page:RecordPage}>{
    return this.recordPage(sessionToken,`/api/v1/worklog/records/group/${sourceId}`,filters,'群組紀錄載入失敗');
  }
  async updateRecord(sessionToken:string,id:number,input:{normalizedSummary:string|null;category:WorklogCategory;customerId:string|null;projectId:string|null}){
    return (await json<{record:Record<string,unknown>}>(await this.request(sessionToken,`/api/v1/worklog/records/${id}`,this.body('PATCH',input)),'紀錄更新失敗')).record;
  }

  async myUsage(sessionToken:string){return (await json<{usage:UserUsage}>(await this.request(sessionToken,'/api/v1/worklog/usage/me'),'AI 額度載入失敗')).usage;}
  async ownerView(sessionToken:string,sourceId:number){const response=await this.request(sessionToken,`/api/v1/worklog/groups/${sourceId}/owner-view`);if(response.status===403)return null;return (await json<{ownerView:GroupOwnerView}>(response,'群組管理資料載入失敗')).ownerView;}
  async setRecordingEnabled(sessionToken:string,sourceId:number,memberUserId:number,enabled:boolean){await json(await this.request(sessionToken,`/api/v1/worklog/groups/${sourceId}/members/${memberUserId}/recording`,this.body('PATCH',{enabled})),'成員紀錄權限更新失敗');}

  async customers(sessionToken:string,query=''){const suffix=query.trim()?`?q=${encodeURIComponent(query.trim())}`:'';return (await json<{customers:Customer[]}>(await this.request(sessionToken,`/api/v1/worklog/customers${suffix}`),'客戶載入失敗')).customers;}
  async createCustomer(sessionToken:string,input:{name:string;phone:string|null;address:string|null;note:string|null}){return (await json<{customer:Customer}>(await this.request(sessionToken,'/api/v1/worklog/customers',this.body('POST',input)),'客戶新增失敗')).customer;}
  async updateCustomer(sessionToken:string,id:string,input:{name:string;phone:string|null;address:string|null;note:string|null}){return (await json<{customer:Customer}>(await this.request(sessionToken,`/api/v1/worklog/customers/${id}`,this.body('PUT',input)),'客戶更新失敗')).customer;}
  async deleteCustomer(sessionToken:string,id:string){await json(await this.request(sessionToken,`/api/v1/worklog/customers/${id}`,{method:'DELETE'}),'客戶刪除失敗');}

  async projects(sessionToken:string,filters:{query?:string;status?:string}={}){const params=new URLSearchParams();if(filters.query?.trim())params.set('q',filters.query.trim());if(filters.status)params.set('status',filters.status);const suffix=params.toString()?`?${params}`:'';return (await json<{projects:Project[]}>(await this.request(sessionToken,`/api/v1/worklog/projects${suffix}`),'專案載入失敗')).projects;}
  async createProject(sessionToken:string,input:{name:string;customerId:string|null;address:string|null;status:Project['status'];note:string|null}){return (await json<{project:Project}>(await this.request(sessionToken,'/api/v1/worklog/projects',this.body('POST',input)),'專案新增失敗')).project;}
  async updateProject(sessionToken:string,id:string,input:{name:string;customerId:string|null;address:string|null;status:Project['status'];note:string|null}){return (await json<{project:Project}>(await this.request(sessionToken,`/api/v1/worklog/projects/${id}`,this.body('PUT',input)),'專案更新失敗')).project;}
  async deleteProject(sessionToken:string,id:string){await json(await this.request(sessionToken,`/api/v1/worklog/projects/${id}`,{method:'DELETE'}),'專案刪除失敗');}

  async transactions(sessionToken:string,projectId=''){const suffix=projectId?`?projectId=${encodeURIComponent(projectId)}`:'';return (await json<{transactions:Transaction[]}>(await this.request(sessionToken,`/api/v1/worklog/transactions${suffix}`),'交易載入失敗')).transactions;}
  async createTransaction(sessionToken:string,input:TransactionInput){return (await json<{transaction:Transaction}>(await this.request(sessionToken,'/api/v1/worklog/transactions',this.body('POST',input)),'交易新增失敗')).transaction;}
  async updateTransaction(sessionToken:string,id:string,input:TransactionInput){return (await json<{transaction:Transaction}>(await this.request(sessionToken,`/api/v1/worklog/transactions/${id}`,this.body('PUT',input)),'交易更新失敗')).transaction;}
  async deleteTransaction(sessionToken:string,id:string){await json(await this.request(sessionToken,`/api/v1/worklog/transactions/${id}`,{method:'DELETE'}),'交易刪除失敗');}

  async submitFeedback(sessionToken:string,text:string,context:Record<string,string|number>){await json(await this.request(sessionToken,'/api/v1/worklog/feedback',this.body('POST',{text,context})),'意見送出失敗');}

  private async recordPage(sessionToken:string,path:string,filters:RecordFilters,fallback:string){
    const params=new URLSearchParams();
    if(filters.query?.trim())params.set('q',filters.query.trim());
    if(filters.inputType)params.set('type',filters.inputType);
    if(filters.category)params.set('category',filters.category);
    if(filters.customerId)params.set('customerId',filters.customerId);
    if(filters.projectId)params.set('projectId',filters.projectId);
    if(filters.from)params.set('from',filters.from);
    if(filters.to)params.set('to',filters.to);
    if(filters.limit)params.set('limit',String(filters.limit));
    if(filters.offset)params.set('offset',String(filters.offset));
    const suffix=params.toString()?`?${params}`:'';
    const body=await json<{records:Record<string,unknown>[];page:RecordPage}>(await this.request(sessionToken,`${path}${suffix}`),fallback);
    return {records:body.records.map(recordFromApi),page:body.page};
  }

  private body(method:string,value:unknown):RequestInit{return{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}}
  private request(sessionToken:string,path:string,init?:RequestInit){const headers=new Headers(init?.headers);headers.set('Authorization',`Bearer ${sessionToken}`);return fetch(this.base(path),{...init,headers});}
}

export type TransactionInput={type:Transaction['type'];amountTwd:string;occurredAt:string;customerId:string|null;projectId:string|null;recordId:number|null;note:string|null};

function recordFromApi(raw:Record<string,unknown>):WorklogRecord{return{
  id:Number(raw.id), sourceId:Number(raw.source_id??raw.sourceId), authorUserId:nullableNumber(raw.author_user_id??raw.authorUserId),
  inputType:String(raw.input_type??raw.inputType) as WorklogInputType, category:String(raw.category) as WorklogCategory,
  rawText:nullableString(raw.raw_text??raw.rawText), normalizedSummary:nullableString(raw.normalized_summary??raw.normalizedSummary),
  customerId:nullableNumber(raw.customer_id??raw.customerId), customerName:nullableString(raw.customer_name??raw.customerName),
  projectId:nullableNumber(raw.project_id??raw.projectId), projectName:nullableString(raw.project_name??raw.projectName),
  sourceTimestamp:nullableString(raw.source_timestamp??raw.sourceTimestamp), editedAt:nullableString(raw.edited_at??raw.editedAt),
  createdAt:String(raw.created_at??raw.createdAt), updatedAt:String(raw.updated_at??raw.updatedAt),
};}
function nullableNumber(value:unknown):number|null{return value===null||value===undefined||value===''?null:Number(value)}
function nullableString(value:unknown):string|null{return value===null||value===undefined?null:String(value)}
