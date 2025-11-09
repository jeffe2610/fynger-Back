import { supabase} from "../supabaseClient.js"

export async function verificarSessao(req, res, next) {
  try {
    // 🔹 1. Verifica se veio o token nos cookies
    const token = req.cookies.access_token;
    if (!token) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // 🔹 2. Usa o token para buscar o usuário logado no Supabase
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({ error: "Sessão inválida" });
    }

    const userId = authData.user.id;

    // 🔹 3. Busca os dados extras na tabela 'usuarios'
    const { data: usuario, error: usuarioError } = await supabase
      .from("usuarios")
      .select("nome, grupo_id, perfil")
      .eq("id", userId)
      .single();

    if (usuarioError || !usuario) {
      return res.status(400).json({ error: "Usuário não encontrado" });
    }

    // 🔹 4. Injeta essas infos no objeto req
    req.user = {
      id: userId,
      nome: usuario.nome,
      grupo_id: usuario.grupo_id,
      perfil: usuario.perfil,
    };

    // 🔹 5. Continua pra rota
    next();
  } catch (err) {
    console.error("Erro no middleware de sessão:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
  console.log(req.user)
}
