import express, { json } from "express";
import cors from "cors";
import { supabase } from "./supabaseClient.js";
import cookieParser from "cookie-parser";
import { verificarSessao } from "./midleware/auth.js";
import { format, startOfMonth, endOfMonth } from "date-fns";
import multer from "multer";

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
  })
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

// LOGOUT
app.post("/logout", (req, res) => {
  res.clearCookie("access_token");
  return res.json({ message: "Logout feito" });
});

// Rota de cadastro
app.post("/signup", async (req, res) => {
  const { email, password, nome, tel, grupoId } = req.body;

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) return res.status(400).json({ error: authError.message });

  const userId = authData.user.id;
  let grupo = null
  if(!grupoId){

    const { data: dataGroup, error: errorGroup } = await supabase
      .from("grupo")
      .insert([
        {
          nome: `grupo de ${nome}`,
          criado_por: userId,
        },
      ])
      .select();
  
    if (errorGroup) {
      res.status(400).json({ error: errorGroup.message });}
    
    grupo = dataGroup
  }
  

  const { data: userData, error: insertError } = await supabase
    .from("usuarios")
    .insert([
      {
        nome: nome,
        email: email,
        telefone: tel,
        perfil: "admin",
        id: userId,
        grupo_id: grupoId? grupoId : grupo[0].id,
      },
    ])
    .select();
  if (insertError) return res.status(400).json({ error: insertError.message });

  return res.json({
    message: "cadastro efetuado com sucesso",
    user: authData,
    cadastro: userData,
  });
});

//  recuperar dados
app.get("/session", verificarSessao, async (req, res) => {
  return res.json({
    nome: req.user.nome,
    message: "sessao Valida",
    grupo_id: req.user.grupo_id,
    perfil: req.user.perfil,
    avatar: req.user.avatar,
    nomeGrupo: req.user.nomeGrupo,
  });
});

//rota de cadatro de transacao

app.post("/transacao", verificarSessao, async (req, res) => {
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
        grupo_id: req.user.grupo_id,
        criado_por: req.user.id,
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
          grupo_id: req.user.grupo_id,
          categoria_id: categoriaselecionada,
        },
      ])
      .select();
    if (recorrenciaError)
      return res.status(400).json({ error: recorrenciaError.message });
  }

  
  return res.json({ cadastro: transData[0] });
});

//rota get  de todas as  transacoes

app.get("/transacao", verificarSessao, async (req, res) => {
  const { data: transData, error: transError } = await supabase
    .from("transacoes")
    .select(
      `
      id,
      tipo,
      valor,
      categoria_id,
      categorias ( nome ),
      data,
      usuarios(nome)
      `
    )
    .eq("grupo_id", req.user.grupo_id)
    .gte("data", inicioMes)
    .lte("data", fimMes);

  if (transError) return res.status(400).json(transError.message);

  const resultado = transData.map((item) => ({
    id: item.id,
    nome: item.tipo,
    valor: item.valor,
    categoria: item.categorias?.nome || "sem categoria",
    data: item.data,
    membro: item.usuarios?.nome,
  }));

  return res.json(resultado);
});
// informações para o grafico de gastos mensais por categoria
app.get("/transacoes-grafico", verificarSessao, async (req, res) => {
  const { data: transData, error: transError } = await supabase
    .from("transacoes")
    .select(
      `
      id,
      valor,
      categorias ( nome, tipo ),
      data,
      recorrencia (valorParcela)
    `
    )
    .eq("grupo_id", req.user.grupo_id)
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
  const { data, error } = await supabase
    .from("categorias")
    .select("*")
    .eq("grupo_id", req.user.grupo_id);

  if (error) {
    return res.status(400).json(error.message);
  }
  return res.json(data);
});

// rota para comparar receitas
app.get("/card-receita", verificarSessao, async (req, res) => {
  const { data, erro } = await supabase
    .from("resumo_mensal")
    .select("*")
    .eq("grupo_id", req.user.grupo_id);

  if (erro) {
    return res.status(400).json(erro.message);
  }
  return res.json(data);
});

// rota para resumo mensal do ususario
app.get("/grupo", verificarSessao, async (req, res) => {
  const { data, error } = await supabase
    .from("resumo_usuarios_mensal")
    .select("*")
    .eq("grupo_id", req.user.grupo_id)
    .eq("mes", mes);

  if (error) {
    res.status(400).json(error.message);
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
    telefone,
    grupo: grupo_id(nome)`
    )
    .eq("id", req.user.id);

  if (userError) {
    return res.status(400).json(error.message);
  }

  const { data: grupoData, error: grupoError } = await supabase
    .from("usuarios")
    .select(
      `
    avatar,
    id,
    nome,
    email`
    )
    .eq("grupo_id", req.user.grupo_id);

  if (grupoError) {
    return res.status(400).json(error.message);
  }
  
  
  const { data: catData, error: catError } = await supabase
    .from("categorias")
    .select(`id, nome,tipo`)
    .eq("grupo_id", req.user.grupo_id);

  if (catError) {
    return res.status(400).json(catError.message);
  }

  const dados = {
    nome: userData[0].nome,
    email: userData[0].email,
    telefone: userData[0].telefone,
    nomeGrupo: userData[0].grupo.nome,
    categorias: catData,
    membros: grupoData,
    avatar: userData[0].avatar,
    grupo_id:req.user.grupo_id
  };

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
  }
);

//atualiza o grupo

app.put("/atualizar-grupo", verificarSessao, async (req, res) => {
  const { nomeGrupo } = req.body;

  const { data, error } = await supabase
    .from("grupo")
    .update({ nome: nomeGrupo })
    .eq("id", req.user.grupo_id);

  if (error) return res.status(400).json(error.message);

  return res.json(data);
});

//add categorias
app.post("/add-categoria", verificarSessao, async (req, res) => {
  const { nomeCategoria, tipoCategoria } = req.body;

  const { data, error } = await supabase
    .from("categorias")
    .insert([
      {
        nome: nomeCategoria,
        tipo: tipoCategoria,
        grupo_id: req.user.grupo_id,
      },
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

// 🔹 Rota simples pra testar se o servidor está rodando
app.get("/", (req, res) => {
  res.send("Servidor está rodando!");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`, mes);
  
});