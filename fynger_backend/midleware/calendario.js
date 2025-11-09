import { format,subMonths,addMonths,startOfMonth, endOfMonth } from "date-fns";


const dia = format(new Date(),"yyyy-MM-dd");
const mesAnterior = format(subMonths(dia,1),"yyyy-MM");
const proximoMes = format(addMonths(dia,1),"yyyy-MM");





