const express = require("express");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// Datos en memoria (para el demo)
const usuarios = [{
  id: 1,
  nombre: "Agustin",
  apellido: "Ibarra",
  email: "agus@gmail.com",
  password: "1234",
  estado: "activo",
  rol: "alumno"
}];



const turnos = [
  { id: 1, fecha: "2026-04-01", hora: "07:00", cupo_maximo: 15 },
  { id: 2, fecha: "2026-04-03", hora: "07:00", cupo_maximo: 15 },
  { id: 3, fecha: "2026-04-05", hora: "07:00", cupo_maximo: 15 }
];

const reservas = [];

app.get("/api/turnos", (req, res) => {
    const turnosConInfo = turnos.map(turno => {
        const ocupados = reservas.filter(r => r.turno_id === turno.id).length;
        const disponibles = turno.cupo_maximo - ocupados;

        return {
            ...turno,
            ocupados,
            disponibles
        };
    });

    res.json(turnosConInfo);
});

app.get("/api/profesor/reservas", (req, res) => {
    const datos = reservas.map(reserva => {
        const usuario = usuarios.find(u => u.id === reserva.usuario_id);
        const turno = turnos.find(t => t.id === reserva.turno_id);

        return {
            id: reserva.id,
            nombre: usuario ? usuario.nombre : "Sin nombre",
            apellido: usuario ? usuario.apellido : "Sin apellido",
            fecha: turno ? turno.fecha : "Sin fecha",
            hora: turno ? turno.hora : "Sin hora",
            estado: reserva.estado
        };
    });

    const reservados = datos.filter(r => r.estado === "reservado");
    const presentes = datos.filter(r => r.estado === "presente");

    res.json({ reservados, presentes });
});
app.get("/api/mis-reservas/:usuario_id", (req, res) => {
    const usuario_id = Number(req.params.usuario_id);

    if (isNaN(usuario_id)) {
        return res.status(400).json({ error: "ID inválido" });
    }

    const misReservas = reservas
        .filter(r => r.usuario_id === usuario_id)
        .map(reserva => {
            const turno = turnos.find(t => t.id === reserva.turno_id);

            return {
                id: reserva.id,
                turno_id: reserva.turno_id,
                fecha: turno ? turno.fecha : "",
                hora: turno ? turno.hora : "",
                estado: reserva.estado
            };
        });

    res.json(misReservas);
});
app.post("/api/register", (req, res) => {
    const { nombre, apellido, email, password } = req.body;

    // Validaciones básicas
    if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    // Verificar email repetido
    const existe = usuarios.find(u => u.email === email);
    if (existe) {
        return res.status(400).json({ error: "Email ya registrado" });
    }

    const nuevoUsuario = {
        id: usuarios.length + 1,
        nombre,
        apellido,
        email,
        password,
        estado: "activo",
        rol: "alumno"
    };

    usuarios.push(nuevoUsuario);

    res.json({ ok: true, usuario: nuevoUsuario });
});

app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Uno de los datos es incorrecto" });
    }

    const usuario = usuarios.find(u => u.email === email);

    if (!usuario) {
        return res.status(400).json({ error: "El usuario no existe" });
    }

    if (usuario.password !== password) {
        return res.status(400).json({ error: "La contraseña es incorrecta" });
    }

    if (usuario.estado !== "activo") {
        return res.status(403).json({ error: "La cuenta no está activa" });
    }

    res.json({ ok: true, usuario });
});

  app.post("/api/reservas", (req, res) => {
    const { usuario_id, turno_id } = req.body;

    if (!usuario_id || !turno_id) {
        return res.status(400).json({ error: "Faltan datos" });
    }

    const usuario = usuarios.find(u => u.id === usuario_id);
    const turno = turnos.find(t => t.id === turno_id);

    if (!turno) {
        return res.status(400).json({ error: "Turno no encontrado" });
    }

    if (!usuario) {
        return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const existeReserva = reservas.find(r =>
        r.usuario_id === usuario_id && r.turno_id === turno_id
    );

    if (existeReserva) {
        return res.status(400).json({ error: "Turno ya reservado" });
    }

    const cantidadReservas = reservas.filter(r => r.turno_id === turno_id).length;

    if (cantidadReservas >= turno.cupo_maximo) {
        return res.status(400).json({ error: "Turno lleno" });
    }

    const nuevaReserva = {
        id: reservas.length + 1,
        usuario_id,
        turno_id,
        estado: "reservado"
    };

    reservas.push(nuevaReserva);

    res.json({ ok: true, reserva: nuevaReserva });
});

app.post("/api/checkin", (req, res) => {
    const { usuario_id, turno_id, codigo_qr} = req.body;
    if (!usuario_id || !turno_id || !codigo_qr) {
        return res.status(400).json({ error: "Faltan datos" });
    }
   if (codigo_qr !== "JJB-ACADEMIA-2026"){
    return res.status(400).json({ error: "QR no concuerda"});
   };
   const reserva = reservas.find(r =>
    r.usuario_id === usuario_id && r.turno_id === turno_id
    );
   if (!reserva){
    return res.status(400).json({ error: "Reserva no existe"})
   }
   if (reserva.estado === "presente") {
    return res.status(400).json({ error: "Ya fue registrado como presente" });
    }
   reserva.estado = "presente";
   res.json({ ok: true });
});

app.delete("/api/reservas/:id", (req, res) => {
    const id = Number(req.params.id);

    if (isNaN(id)) {
        return res.status(400).json({ error: "ID no identificable" });
    }

    const index = reservas.findIndex(r => r.id === id);

    if (index === -1) {
        return res.status(404).json({ error: "Reserva no encontrada" });
    }

    reservas.splice(index, 1);

    res.json({ ok: true });
});

app.listen(3000, () => {
    console.log("Servidor en http://localhost:3000");
});