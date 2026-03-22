import express, { json } from "express";
import cors from "cors";
import { supabase, supabaseAdmim } from "./supabaseClient.js";
import cookieParser from "cookie-parser";
import { verificarSessao } from "./midleware/auth.js";
import { format, startOfMonth, endOfMonth } from "date-fns";
import multer from "multer";
import { __await } from "tslib";

const mes = format(new Date(), "yyyy-MM");
const inicioMes = format(startOfMonth(new Date()), "yyyy-MM-dd");
const fimMes = format(endOfMonth(new Date()), "yyyy-MM-dd");
const storage = multer.memoryStorage();
const upload = multer({ storage });

const app = express();

app.use(
  cors({
    origin: ["http://localhost:5173", "https://fynger-front.vercel.app"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// Rota de login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) return res.status(400).json({ error: error.message });

  return res.json({
    token: data.session.access_token,
    user_id: data.user.id,
  });
});

// Rota de cadastro
app.post("/signup", async (req, res) => {
  const { email, password, nome, tel } = req.body;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) return res.status(400).json({ error: authError.message });

  const userId = authData.user.id;

  const { data: userData, error: insertError } = await supabaseAdmim
    .from("usuarios")
    .insert([
      {
        nome: nome,
        email: email,
        telefone: tel,
        id: userId,
      },
    ])
    .select();
  if (insertError) return res.status(400).json({ error: insertError.message });

  return res.json({
    message: "cadastro efetuado com sucesso",
  });
});

app.get("/session", verificarSessao, async (req, res) => {
  return res.json({
    nome: req.user.nome,
    message: "sessao Valida",
    avatar: req.user.avatar,
  });
});

app.post("/transacao", verificarSessao, async (req, res) => {
  const contexto = req.headers["x-contexto"];
  const grupo = req.headers["x-atualgroup"];
  const {
    nome,
    valor,
    descricao,
    categoriaselecionada,
    parcelas,
    data,
    vencimento,
    tipo,
  } = req.body;

  const { data: transData, error: transError } = await supabase
    .from("transacoes")
    .insert([
      {
        tipo: nome,
        valor: valor,
        descricao: descricao,
        total_parcelas: parcelas,
        data: data,
        vencimento: vencimento,
        categoria_id: categoriaselecionada,
        criado_por: req.user.id,
        grupo_id: contexto === "pessoal" ? null : grupo,
      },
    ])
    .select();

  if (transError) return res.status(400).json({ error: transError.message });

  if (parcelas !== 1) {
    const { data: recorrenciaData, error: recorrenciaError } = await supabase
      .from("recorrencia")
      .insert([
        {
          id: transData[0].id,
          descricao: nome,
          valor: valor,
          qtdParcelas: parcelas,
          proxima_execucao: vencimento,
          ativo: true,
          valorParcela: valor / parcelas,
          tipo: tipo,
          criado_por: req.user.id,
          categoria_id: categoriaselecionada,
          grupo_id: contexto === "pessoal" ? null : grupo,
        },
      ])
      .select();
    if (recorrenciaError)
      return res.status(400).json({ error: recorrenciaError.message });
  }

  return res.json({ cadastro: transData[0] });
});

app.get("/transacao", verificarSessao, async (req, res) => {
  const contexto = req.headers["x-contexto"];
  const grupo = req.headers["x-atualgroup"];
  console.log(grupo);
  let query = supabase.from("transacoes").select(
    `
      id,
      tipo,
      valor,
      categoria_id,
      categorias( nome, tipo ),
      data
      `,
  );

  if (contexto === "pessoal") {
    query = query.eq("criado_por", req.user.id).is("grupo_id", null);
  } else {
    query = query.eq("grupo_id", grupo);
  }

  const { data: transData, error: transError } = await query
    .gte("data", inicioMes)
    .lte("data", fimMes);

  if (transError) return res.status(400).json(transError.message);

  const resultado = transData.map((item) => ({
    id: item.id,
    nome: item.tipo,
    valor: item.valor,
    categoria: item.categorias?.nome || "sem categoria",
    tipo: item.categorias?.tipo,
    data: item.data,
  }));

  return res.json(resultado);
});
// informações para o grafico de gastos mensais por categoria
app.get("/transacoes-grafico", verificarSessao, async (req, res) => {
  const contexto = req.headers["x-contexto"];
  const grupo = req.headers["x-atualgroup"];

  let query = supabase.from("transacoes").select(
    `id,
     valor,
     categorias ( nome, tipo ),
     data,
     recorrencia (valorParcela)
     grupo_id`,
  );

  if (contexto === "pessoal") {
    query = query.eq("criado_por", req.user.id).is("grupo_id", null);
  } else {
    query = query.eq("grupo_id", grupo);
  }

  const { data: transData, error: transError } = await query
    .gte("data", inicioMes)
    .lte("data", fimMes);

  if (transError) return res.status(400).json(transError.message);

  const resultado = transData
    .filter((item) => item.categorias.tipo === "despesa")
    .map((item) => ({
      id: item.id,
      valor: item.recorrencia?.valorParcela || item.valor,
      categoria: item.categorias?.nome || "sem categoria",
      data: item.data,
    }));

  const agrupado = resultado.reduce((acumulado, item) => {
    if (!acumulado[item.categoria]) {
      acumulado[item.categoria] = 0;
    }
    acumulado[item.categoria] += item.valor;

    return acumulado;
  }, {});

  const respostaFinal = Object.entries(agrupado).map(([categoria, valor]) => ({
    categoria,
    valor: Number(valor.toFixed(2)),
  }));

  return res.json(respostaFinal);
});

// rota para exibir categorias
app.get("/categorias", verificarSessao, async (req, res) => {
  const contexto = req.headers["x-contexto"];
  const grupo = req.headers["x-atualgroup"];

  let query = supabase.from("categorias").select("*");

  if (contexto === "pessoal") {
    query = query.eq("criado_por", req.user.id).is("grupo_id", null);
  } else {
    query = query.eq("grupo_id", grupo);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(400).json(error.message);
  }
  return res.json(data);
});

app.get("/categorias-pill", verificarSessao, async (req,res)=> {
  const {idGroup} = req.query;
  const {data,error} = await supabase
  .from("categorias")
  .select("*")
  .eq("grupo_id",idGroup)

  if (error){return res.status(400).json(error.message)}
   return(res.json(data))
})

// rota para comparar receitas
app.get("/cards-receitas-despesas", verificarSessao, async (req, res) => {
  const contexto = req.headers["x-contexto"];
  const grupo = req.headers["x-atualgroup"];
  console.log("headers:", req.headers);
  console.log("contexto:", contexto);
  console.log("grupo:", grupo);
  let query = supabase.from("transacoes").select(`
      id,
      valor,
      criado_por,
      grupo_id,
      tipo: categoria_id(tipo),
      data
      `);

  if (contexto === "pessoal") {
    query = query.eq("criado_por", req.user.id).is("grupo_id", null);
  } else {
    query = query.eq("grupo_id", grupo);
  }
  const { data, error } = await query
    .gte("data", inicioMes)
    .lte("data", fimMes);
  if (error) {
    return res.status(400).json(error.message);
  }

  if (!data) {
    return res.json({ message: "sem transacoes" });
  }

  const balanco = data.reduce((acc, transacao) => {
    const mes = transacao.data.slice(0, 7);
    const tipo = transacao.tipo.tipo;
    const valor = transacao.valor;

    if (!acc[mes]) {
      acc[mes] = {
        mes,
        despesa: 0,
        receita: 0,
      };
    }

    if (tipo === "despesa") {
      acc[mes].despesa += valor;
    } else {
      acc[mes].receita += valor;
    }

    return acc;
  }, {});

  return res.json(Object.values(balanco));
});

// rota para membros do grupo

app.get("/membros", verificarSessao, async (req, res) => {
  const grupo = req.headers["x-atualgroup"];
  const { data, error } = await supabase

    .from("membro_grupo")
    .select(
      `
      membro_id,
      usuarios(nome, avatar),
      perfil
      `,
    )
    .eq("grupo_id", grupo);

  if (error) {
    return res.status(400).json(error.message);
  }

  const { data: dataTrans, error: errorTrans } = await supabase
    .from("transacoes")
    .select(`valor,criado_por`)
    .eq("grupo_id", grupo)
    .gte("data", inicioMes)
    .lte("data", fimMes);

  if (errorTrans) {
    return res.status(400).json(errorTrans.message);
  }

  const balanco = dataTrans.reduce((acc, transacao) => {
    const usuario = transacao.criado_por;
    const valor = transacao.valor;

    if (!acc[usuario]) {
      acc[usuario] = {
        gasto: 0,
      };
    }

    acc[usuario].gasto += valor;

    return acc;
  }, {});

  const result = data.map((item) => ({
    perfil: item.perfil,
    nome: item.usuarios.nome,
    avatar: item.usuarios.avatar,
    gasto: balanco[item.membro_id]?.gasto || 0,
  }));

  return res.json(result);
});

// rota para criar grupo

app.post("/create-group", verificarSessao, async (req, res) => {
  const { nome, descricao } = req.body;

  const { data, error } = await supabase
    .from("grupo")
    .insert([
      {
        nome: nome,
        descricao: descricao,
        criado_por: req.user.id,
      },
    ])
    .select();
  if (error) {
    return res.status(400).json(error.message);
  }

  const { data: dataRelacao, error: errorRelacao } = await supabase
    .from("membro_grupo")
    .insert([
      {
        grupo_id: data[0].id,
        perfil: "Admin",
        membro_id: req.user.id,
      },
    ])
    .select();
  if (errorRelacao) {
    return res.status(400).json(errorRelacao.message);
  }

  return res.json({ message: "cadastro Efetuado" });
});


// rota para ingressar em grupo existente

app.post("/entrar-grupo", verificarSessao, async (req, res) => {
  const { codigoGrupo } = req.body;

  const { data, error } = await supabase
    .from("membro_grupo")
    .insert([
      {
        grupo_id: codigoGrupo,
        perfil: "Membro",
        membro_id: req.user.id,
      },
    ])
    .select();
  if (error) {
    console.log(error);
    switch (error.code) {
      case "23503":
        return res.status(400).json({ message: "Código invalido ou grupo Não exite" }); // codigo invalido
      case "23505":
        return res.status(400).json({ message: "Você já é membro deste grupo" }); // ja participa do grupo

      default:
        return res
          .status(500)
          .json(error.data.message /* { message: "Erro interno." } */);
    }
  }
  return res.json(data);
});
//rota para sAIR DO GRUPO 

app.delete("/sair-grupo", verificarSessao, async(req, res)=>{
  const {id} =  req.body
  const {data, error} = await supabase
  .from("membro_grupo")
  .delete()
  .eq("grupo_id",id)
  .eq("membro_id", req.user.id)
  .select()

  if(error){return res.status(400).json(error.message)}

    return res.json(data)

})





// rota para buscar grupo

app.get("/grupos", verificarSessao, async (req, res) => {
  const { data, error } = await supabase
    .from("membro_grupo")
    .select(
      `
    grupo_id,
    perfil,     
    grupo(nome)`,
    )
    .eq("membro_id", req.user.id);

  if (error) {
    return res.status(400).json(error.message);
  }

  const result = data.map((item) => ({
    grupo_id: item.grupo_id,
    perfil: item.perfil,
    nome: item.grupo.nome,
  }));
  return res.json(result);
});

//rota card grupo

app.get("/card-grupo", verificarSessao, async (req, res) => {
  const { data, error } = await supabase
    .from("membro_grupo")
    .select(`
      perfil,
      grupo (
        id,
        nome,
        descricao,
        membros: membro_grupo (
          perfil,
          usuarios (
          id,  
          avatar,
            nome,
            email
          )
        )
      )
    `)
    .eq("membro_id", req.user.id)

  if (error) {
    return res.status(400).json(error.message)
  }

  
  return res.json(data);
});

// ROTAS PARA MODAL DE ajustes

// informações para preencher os iputs do modal de ajustes
app.get("/atualizar-dados", verificarSessao, async (req, res) => {
  const { data: userData, error: userError } = await supabase
    .from("usuarios")
    .select(
      `
    avatar,
    nome,
    email,
    telefone
    `,
    )
    .eq("id", req.user.id);
  if (userError) {
    return res.status(400).json(error.message);
  }


  const { data: catData, error: catError } = await supabase
    .from("categorias")
    .select(`id, nome,tipo`)
    .eq("criado_por", req.user.id);

  if (catError) {
    return res.status(400).json(catError.message);
  }

  const dados = {
    nome: userData[0]?.nome,
    email: userData[0]?.email,
    telefone: userData[0]?.telefone,
    categorias: catData,
    avatar: userData[0].avatar,
    
  };

  console.log("dados filtrados", dados);
  return res.json(dados);
});

//atualiza perfil
app.put("/atualizar-perfil", verificarSessao, async (req, res) => {
  const userId = req.user.id;
  const { nome, telefone, senha, novaSenha } = req.body;

  const updates = {};

  if (nome && nome.trim() !== "") {
    updates.nome = nome.trim();
  }
  if (telefone && telefone.trim() !== "") {
    updates.telefone = telefone.trim();
  }

  if (senha && novaSenha) {
    const { data: user, error: userError } =
      await supabase.auth.signInWithPassword({
        email: req.user.email,
        password: senha,
      });

    if (userError) return res.status(400).json({ error: userError.message });

    await supabase.auth.updateUser({ password: novaSenha });
  }

  try {
    const { data, error } = await supabase
      .from("usuarios")
      .update(updates)
      .eq("id", userId)
      .select();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ msg: "Perfil atualizado com sucesso!", data });
  } catch (error) {
    console.log(error);
  }
});

// atualiza o avatar
app.put(
  "/atualiza-avatar",
  upload.single("avatar"),
  verificarSessao,
  async (req, res) => {
    try {
      const file = req.file;
      const userId = req.user.id;

      if (!file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }

      const ext = file.originalname.split(".").pop();

      const filePath = `avatars/${userId}.${ext}`;

      const { error: errorFile } = await supabase.storage
        .from("Avatars")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (errorFile) throw errorFile;

      const { data: dataUrl, error: errorUrl } = supabase.storage
        .from("Avatars")
        .getPublicUrl(filePath);

      if (errorUrl) throw errorUrl;

      const publicUrl = dataUrl.publicUrl;

      const { error } = await supabase
        .from("usuarios")
        .update({ avatar: publicUrl })
        .eq("id", userId);

      if (error) throw error;
    } catch (err) {
      console.log(err);
      res.status(500).json({ error: "Erro ao atualizar avatar" });
    }
  },
);

//atualiza o grupo

app.put("/atualizar-grupo", verificarSessao, async (req, res) => {
  const grupo = req.headers["x-atualgroup"];

  
  const { nomeGrupo } = req.body;

  const { data, error } = await supabase
    .from("grupo")
    .update({ nome: nomeGrupo })
    .eq("id", grupo);

  if (error) return res.status(400).json(error.message);

  return res.json(data);
});

//add categorias
app.post("/add-categoria", verificarSessao, async (req, res) => {
  const { nomeCategoria, tipoCategoria, idGroup } = req.body;

  const { data, error } = await supabase
    .from("categorias")
    .insert([
      {
        nome: nomeCategoria,
        tipo: tipoCategoria,
        criado_por: req.user.id,
        grupo_id: idGroup}
    ])
    .select();

  if (error) {
    return res.status(400).json(error.message);
  }
  return res.json(data);
});

//deleta categorias

app.delete("/del-categoria", async (req, res) => {
  const { id } = req.body;

  const { data, error } = await supabase
    .from("categorias")
    .delete()
    .eq("id", id)
    .select();
  if (error) res.status(400).json(error.message);

  return res.json(data);
});

//deleta transações
app.delete("/del-transacao", async (req, res) => {
  const { id } = req.body;
  const { data, error } = await supabase
    .from("transacoes")
    .delete()
    .eq("id", id);

  if (error) res.status(400).json(error.message);
  return res.json(data);
});

//deleta Grupos
app.delete("/delete-grupo", async (req, res) => {
  const { id } = req.body;

  const { data, error } = await supabase
    .from("grupo")
    .delete()
    .eq("id", id)
    .select();
  if (error) res.status(400).json(error.message);

  return res.json(data);
});

// rota para atualizar role 


app.put("/atualizar-permissao", verificarSessao, async (req, res) => {
  const {id,idGroup,permissao} = req.body;


  const { data, error } = await supabase
    .from("membro_grupo")
    .update({ perfil: permissao })
    .eq("membro_id", id)
    .eq("grupo_id", idGroup)
    .select()

  if (error) return res.status(400).json(error.message);

  return res.json(data);
});

//rotapararemover usuarios do grupo  app.delete("/delete-grupo", async (req, res) => {
app.delete("/remover-user-grupo", async (req, res) => {
  const { id, idGroup } = req.body;

  const { data, error } = await supabase
    .from("membro_grupo")
    .delete()
    .eq("membro_id", id)
    .eq("grupo_id", idGroup)
    .select();
  if (error) res.status(400).json(error.message);

  return res.json(data);
});




// 🔹 Rota simples pra testar se o servidor está rodando
app.get("/", (req, res) => {
  res.send("Servidor está rodando!");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`, mes);
});
