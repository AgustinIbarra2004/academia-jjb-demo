const dotenv = require("dotenv").config();
const express = require("express");
const path = require("path");
const app = express();
const pool = require("./db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
 
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

pool.query("SELECT NOW()", (err, result) => {
  if (err) {
    console.error("Error conectando a la base de datos:", err);
  } else {
    console.log("Base de datos conectada:", result.rows);
  }
});

function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token no enviado" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token inválido" });
  }

  try {
    const usuario = jwt.verify(token, JWT_SECRET);

    req.usuario = usuario;

    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

app.get("/api/perfil", verificarToken, (req, res) => {
  res.json({
    ok: true,
    usuario: req.usuario
  });
});
app.get("/api/turnos", async (req, res) => {
  try {
    const resultado = await pool.query("SELECT * FROM turnos");

    const turnosConInfo = await Promise.all(
      resultado.rows.map(async (turno) => {
        const cantidadResultado = await pool.query(
          "SELECT COUNT(*) FROM reservas WHERE turno_id = $1",
          [turno.id]
        );

        const ocupados = Number(cantidadResultado.rows[0].count);
        const disponibles = turno.cupo_maximo - ocupados;

        return {
          ...turno,
          ocupados,
          disponibles,
        };
      })
    );

    res.json(turnosConInfo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.get("/api/profesor/reservas", verificarToken, async (req, res) => {
  try {
    if (req.usuario.rol !== "profesor") {
      return res.status(403).json({ error: "No tenés permiso para ver esta información" });
    }

    const resultado = await pool.query(`
      SELECT reservas.id, usuarios.nombre, usuarios.apellido, turnos.fecha, turnos.hora, reservas.estado
      FROM reservas
      JOIN usuarios ON reservas.usuario_id = usuarios.id
      JOIN turnos ON reservas.turno_id = turnos.id
    `);

    const datos = resultado.rows;

    const reservados = datos.filter(r => r.estado === "reservado");
    const presentes = datos.filter(r => r.estado === "presente");

    res.json({ reservados, presentes });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.get("/api/mis-reservas", verificarToken, async (req, res) => {
  try {
    const usuario_id = req.usuario.id;

    const resultado = await pool.query(
      `
      SELECT reservas.id, reservas.turno_id, turnos.fecha, turnos.hora, reservas.estado
      FROM reservas
      JOIN turnos ON reservas.turno_id = turnos.id
      WHERE reservas.usuario_id = $1
      `,
      [usuario_id]
    );

    res.json(resultado.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.post("/api/register", async (req, res) => {
  const { nombre, apellido, email, password } = req.body;

  if (!nombre || !apellido || !email || !password) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {
    const existe = await pool.query(
      "SELECT id FROM usuarios WHERE email = $1",
      [email]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ error: "Email ya registrado" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, apellido, email, password, estado, rol)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nombre, apellido, email, passwordHash, "activo", "alumno"]
    );

    const usuario = resultado.rows[0];

    delete usuario.password;

    res.json({ ok: true, usuario });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Uno de los datos es incorrecto" });
  }

  try {
    const resultado = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1",
      [email]
    );

    const usuario = resultado.rows[0];

    if (!usuario) {
      return res.status(400).json({ error: "El usuario no existe" });
    }

    const valido = await bcrypt.compare(password, usuario.password);

    if (!valido) {
     return res.status(400).json({ error: "Contraseña incorrecta" });
    }

    if (usuario.estado !== "activo") {
  return res.status(403).json({ error: "La cuenta no está activa" });
}

// 🔥 CREAR TOKEN
    const token = jwt.sign(
  {
    id: usuario.id,
    email: usuario.email,
    rol: usuario.rol
  },
  JWT_SECRET,
  { expiresIn: "2h" }
);

// 🔒 SACAR PASSWORD
const usuarioSeguro = { ...usuario };
delete usuarioSeguro.password;

// 🔥 RESPUESTA FINAL
res.json({
  ok: true,
  usuario: usuarioSeguro,
  token
});

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.post("/api/reservas", verificarToken, async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { turno_id } = req.body;

   if (!turno_id) {
  return res.status(400).json({ error: "Falta el turno" });
  }

    const usuarioResultado = await pool.query(
      "SELECT * FROM usuarios WHERE id = $1",
      [usuario_id]
    );
    const usuario = usuarioResultado.rows[0];

    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const turnoResultado = await pool.query(
      "SELECT * FROM turnos WHERE id = $1",
      [turno_id]
    );
    const turno = turnoResultado.rows[0];

    if (!turno) {
      return res.status(404).json({ error: "Turno no encontrado" });
    }

    const reservaExistente = await pool.query(
      "SELECT * FROM reservas WHERE usuario_id = $1 AND turno_id = $2",
      [usuario_id, turno_id]
    );

    if (reservaExistente.rows[0]) {
      return res.status(400).json({ error: "Ya existe esa reserva" });
    }

    const cantidadResultado = await pool.query(
      "SELECT COUNT(*) FROM reservas WHERE turno_id = $1",
      [turno_id]
    );
    const cantidad = Number(cantidadResultado.rows[0].count);

    if (cantidad >= turno.cupo_maximo) {
      return res.status(400).json({ error: "Turno lleno" });
    }

    const nuevaReserva = await pool.query(
      `INSERT INTO reservas (usuario_id, turno_id, estado)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [usuario_id, turno_id, "reservado"]
    );

    res.json({ ok: true, reserva: nuevaReserva.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.post("/api/checkin", verificarToken, async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { turno_id, codigo_qr } = req.body;

    if (!turno_id || !codigo_qr) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    if (codigo_qr !== "JJB-ACADEMIA-2026") {
      return res.status(400).json({ error: "QR no concuerda" });
    }

    const reservaResultado = await pool.query(
      "SELECT * FROM reservas WHERE usuario_id = $1 AND turno_id = $2",
      [usuario_id, turno_id]
    );

    const reserva = reservaResultado.rows[0];

    if (!reserva) {
      return res.status(400).json({ error: "Reserva no existe" });
    }

    if (reserva.estado === "presente") {
      return res.status(400).json({ error: "Ya fue registrado como presente" });
    }

    const actualizada = await pool.query(
      `UPDATE reservas
       SET estado = $1
       WHERE id = $2
       RETURNING *`,
      ["presente", reserva.id]
    );

    res.json({
      ok: true,
      reserva: actualizada.rows[0]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

app.delete("/api/reservas/:id", verificarToken, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const usuario_id = req.usuario.id;
    const rol = req.usuario.rol;

    if (isNaN(id)) {
      return res.status(400).json({ error: "ID no identificable" });
    }

    const reservaResultado = await pool.query(
      "SELECT * FROM reservas WHERE id = $1",
      [id]
    );

    const reserva = reservaResultado.rows[0];

    if (!reserva) {
      return res.status(404).json({ error: "Reserva no encontrada" });
    }

    if (rol !== "profesor" && reserva.usuario_id !== usuario_id) {
      return res.status(403).json({ error: "No podés cancelar una reserva ajena" });
    }

    await pool.query(
      "DELETE FROM reservas WHERE id = $1",
      [id]
    );

    res.json({ ok: true, mensaje: "Reserva cancelada correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error del servidor" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});