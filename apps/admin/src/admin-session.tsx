import { createContext, useContext } from 'react';import type{AdminSession}from'./management-api';
export const AdminSessionContext=createContext<{session:AdminSession;refresh:()=>Promise<void>}>({session:{id:0,username:'',roleId:'',roleName:'',isSuperAdmin:false,permissions:[],mustChangePassword:false},refresh:async()=>{}});
export function useAdminSession(){const context=useContext(AdminSessionContext);return {...context,can:(permission:string)=>context.session.isSuperAdmin||context.session.permissions.includes(permission)};}
