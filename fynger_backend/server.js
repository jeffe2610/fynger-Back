import express, { json } from "express";
import cors from "cors";
import { supabase } from "./supabaseClient.js";
import cookieParser from "cookie-parser";
import { verificarSessao } from "./midleware/auth.js";
import {format, startOfMonth, endOfMonth} from 'date-fns'

const mes = format(new Date(), 'yyyy-MM')
const inicioMes= format(startOfMonth(new Date()),"yyyy-MM-dd")
const fimMes= format(endOfMonth(new Date()),"yyyy-MM-dd")





const app = express();
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());









// 🔹 Rota de login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) return res.status(400).json({ error: error.message });
  
  res.cookie("access_token", data.session.access_token, {
    httpOnly: true,
    secure: false,
    maxAge: 24*60*60*1000,
    sameSite: "lax"
  });
  
  console.log("usuario",data.session)
  return res.json({ user: data.user });
});



// LOGOUT
app.post("/logout", (req, res) => {
  res.clearCookie("access_token");
  return res.json({ message: "Logout feito" });
});


// 🔹 Rota de cadastro
app.post("/signup", async (req, res) => {
  const { email, password, nome, tel } = req.body;
  
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });
  
  
  if (authError) return res.status(400).json({ error: authError.message });

  
  const userId = authData.user.id;

  const {data:dataGroup, error: errorGroup} = await supabase
  .from("grupo")
  .insert([{
    nome: `grupo do ${nome}`,
    criado_por: userId
  }]).select()
  
  if(errorGroup){res.status(400).json({error: errorGroup.message})}
  
 


  const { data: userData , error: insertError } = await supabase.from('usuarios').insert([
    { nome: nome,
      email: email,
      telefone: tel,
      perfil: "admin",
      id : userId, 
      grupo_id: dataGroup[0].id
    }
  ]).select()
  if (insertError) return res.status(400).json({ error: insertError.message });


  return res.json({
    message: "cadastro efetuado com sucesso",
    user: authData,
    group: dataGroup,
    cadastro: userData,
  });
});


// VALIDAR SESSÃO
app.get("/session", verificarSessao ,async (req, res) => {
  return res.json({
    nome: req.user.nome,
    message: "sessao Valida",
    grupo_id: req.user.grupo_id
  })

  
});



//rota de cadatro de transacao 

app.post("/transacao",verificarSessao ,async (req, res)=>{
  const{ nome, valor, descricao,categoriaselecionada, parcelas, data, vencimento  }= req.body

  const{ data:transData, error:transError} = await supabase.from("transacoes").insert([
    { tipo:nome,
      valor:valor,
      descricao:descricao,
      total_parcelas:parcelas,
      data:data,
      vencimento:vencimento,
      categoria_id:categoriaselecionada,
      grupo_id: req.user.grupo_id,
      criado_por: req.user.id
    }
    
  ]).select()
 
  if(transError) return res.status(400).json({error: transError.message})
    return res.json({cadastro: transData[0]})
  
});



//rota de todas as  transacoes


app.get("/transacao",verificarSessao,async (req, res)=>{
  
  
  
  const { data:transData, error:transError} = await supabase
  .from("transacoes")
  .select(`
      id,
      tipo,
      valor,
      categoria_id,
      categorias ( nome ),
      data,
      usuarios(nome)
    `)
    .eq("grupo_id", req.user.grupo_id)
    .gte('data', inicioMes)
    .lte("data", fimMes)
   
  
  
  if(transError) return res.status(400).json(transError.message)
    
  const resultado = transData.map((item)=>({
    id: item.id,
    nome: item.tipo,
    valor: item.valor,
    categoria:item.categorias?.nome || "sem categoria",
    data: item.data,
    membro: item.usuarios?.nome 
  }))
  
    return res.json(resultado)
})


// rota pra categorias
app.get('/gastos-categoria',verificarSessao,async (req,res)=>{
  const {data:catData, error:catError } = await supabase
  .from('gastos_por_categoria')
  .select("*")
  .eq('grupo_id', req.user.grupo_id)
  .eq('mes', mes)
  if(catError) return res.status(400).json(catError.message)
    return res.json(catData)
})

app.get('/categorias',async (req,res)=>{
  const{data ,error} = await supabase
  .from('categorias')
  .select("*")
  
  
  if (error){return res.status(400).json(error.message)}
   return res.json(data)
})



app.get("/card-receita",verificarSessao,async (req, res)=>{
  const{ data, erro} = await supabase
  .from("resumo_mensal")
  .select("*")
  .eq('grupo_id', req.user.grupo_id);
  

  if(erro){return res.status(400).json(erro.message)}
    return res.json(data)
})



app.get("/grupo",verificarSessao,async(req, res)=>{
  const{ data, error} = await supabase
  .from('resumo_usuarios_mensal')
  .select('*')
  .eq("grupo_id", req.user.grupo_id)
  .eq("mes", mes)

  if(error){res.status(400).json(error.message)}
    return res.json(data) 
    
})




// 🔹 Rota simples pra testar se o servidor está rodando
app.get("/", (req, res) => {
  res.send("Servidor está rodando!");
});



const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`, mes);
  
});