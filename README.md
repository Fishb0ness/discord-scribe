<p align="center"><img src="site/logo.svg" width="96" alt="Logo de discord-scribe"></p>

# discord-scribe

Un **bot privado y autoalojado que toma notas** en Discord. Graba un canal de voz **por participante**, lo transcribe
**en local** con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), lo resume de forma opcional con la
[CLI de Claude Code](https://docs.claude.com/en/docs/claude-code) y entrega una transcripción y un resumen en Markdown.

Sitio web: <https://fishb0ness.github.io/discord-scribe/>

Tú ejecutas tu propia aplicación de Discord en tu propio equipo. No hay ningún servicio alojado y nadie más puede
invitar a tu bot (consulta [Privacidad y acceso](#privacidad-y-acceso)).

```
/grabar  ->  el bot entra en tu canal de voz, anuncia la grabación y se renombra "[GRABANDO] ..."
/parar   ->  WAV por usuario -> whisper-cli -> transcripción fusionada -> resumen con claude -p
             recordings/<YYYY-MM-DD_HHmm>-<canal>/{transcript.md,summary.md}
             resumen publicado en el canal de texto donde se usó /grabar (+ transcript.md adjunto)
```

El bot, la documentación y el sitio web están en español de España; el código y sus comentarios están en inglés. Los
mensajes del bot en el chat y el resumen salen siempre en español. `WHISPER_LANGUAGE` y `WHISPER_PROMPT` permiten
cambiar el idioma de la transcripción, pero no el de los mensajes ni el del resumen. Funciona en macOS, Linux y
Windows.

## Privacidad y acceso

- **El audio nunca sale de tu equipo.** El audio de cada usuario se escribe en una carpeta temporal, whisper.cpp lo
  transcribe en local y se borra en cuanto se transcribe.
- **El texto de la transcripción (no el audio) se envía a Anthropic** solo para generar el resumen, a través de la CLI
  `claude` y *tu propio* inicio de sesión de Claude. Define `SUMMARY_ENABLED=false` para desactivarlo: el bot solo
  genera entonces la transcripción y `claude` no se ejecuta nunca.
- **Solo tus servidores.** `ALLOWED_GUILD_IDS` es obligatorio. El bot registra sus comandos únicamente en esos
  servidores, ignora las interacciones de cualquier otro sitio (incluidos los mensajes directos) y **abandona cualquier
  otro servidor** al que lo añadan.
- **Solo las personas que tú permitas pueden iniciar una grabación.** Restringe `/grabar` con los permisos de comandos
  de Discord (más abajo). `/parar` solo funciona para quien esté en el canal de voz que se está grabando.
- **Avisa a las personas a las que grabas.** Grabar voces tiene consecuencias legales (RGPD y leyes similares). El bot
  anuncia la grabación en el canal de texto y se renombra a `[GRABANDO] ...` durante toda la sesión, pero obtener el
  consentimiento es responsabilidad tuya.
- El token del bot vive solo en tu `.env` local, que git ignora. Un hook de pre-commit y un análisis en CI impiden
  publicar secretos (consulta [Desarrollo](#desarrollo)).

## Requisitos previos

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Node.js 22+ | `brew install node` o [nodejs.org](https://nodejs.org) | tu gestor de paquetes o [nodejs.org](https://nodejs.org) | [nodejs.org](https://nodejs.org) |
| git | las herramientas de Xcode o `brew install git` | tu gestor de paquetes | [Git for Windows](https://gitforwindows.org) |
| whisper.cpp (`whisper-cli`) | `brew install whisper-cpp` | compílalo desde el código fuente (más abajo) | zip de la release o compílalo desde el código fuente (más abajo) |
| CLI de Claude Code (`claude`), con la sesión iniciada | consulta su documentación | consulta su documentación | consulta su documentación |

La CLI de Claude solo hace falta cuando `SUMMARY_ENABLED` no es `false`. Compruébala con `claude -p "hi"`.

**whisper.cpp en Linux** (necesita `git`, `cmake` y un compilador de C++):

```sh
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
# el binario es build/bin/whisper-cli: ponlo en el PATH o define WHISPER_BIN con su ruta completa
```

**whisper.cpp en Windows:** descarga un zip precompilado de las
[releases de whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases) (busca `whisper-bin-x64.zip`) o compílalo
con los mismos comandos de CMake. Define `WHISPER_BIN` con la ruta completa de `whisper-cli.exe`, salvo que esté en el
`PATH`. Las compilaciones con GPU (Metal en macOS, CUDA o Vulkan en el resto) son mucho más rápidas; consulta el README
de whisper.cpp.

La decodificación de Opus usa `@discordjs/opus`, que incluye binarios precompilados para macOS (x64/arm64), Linux
(x64/arm64, glibc y musl) y Windows x64. En cualquier otra plataforma, el bot recurre automáticamente al decodificador
WebAssembly `opusscript` incluido (más lento, pero no necesita compilador).

## Instalación

```sh
git clone <este repositorio> discord-scribe && cd discord-scribe
npm install
npm run download-models      # large-v3 (unos 3 GB) + Silero VAD en models/
cp .env.example .env         # en Windows: copy .env.example .env
```

`npm install` lee `.npmrc`, que permite una dependencia de git (Dysnomia) y los scripts de instalación de los paquetes
nativos, y activa los hooks de git. Si tu configuración global de npm es más estricta, conserva ese archivo.

El modelo Silero VAD es importante: sin él, Whisper se inventa texto en los silencios ("Gracias.", "Subtitulos
realizados por la comunidad de Amara.org"). Con un archivo por participante, cada pista es sobre todo silencio. El
fusionador de transcripciones también descarta las alucinaciones más conocidas como segunda línea de defensa.
`npm run download-models -- --turbo` descarga además el modelo large-v3-turbo, más rápido pero menos preciso.

### Crea tu aplicación de Discord

El Developer Portal está en inglés, así que sus opciones se citan tal y como aparecen allí.

1. Abre el [Developer Portal](https://discord.com/developers/applications) y crea una **New Application**.
2. Copia el **Application ID** en `DISCORD_APP_ID` dentro de `.env`.
3. Pestaña **Installation**: desmarca **User Install** (deja solo **Guild Install**). En Guild Install, añade los
   scopes `bot` y `applications.commands` y los permisos que se indican en el paso 6.
4. Pestaña **Bot**:
   - Desactiva **Public Bot**, para que solo tú puedas añadir el bot a un servidor.
   - Haz clic en **Reset Token** y copia el token en `DISCORD_TOKEN`. No lo compartas ni lo subas a git nunca.
   - **Privileged Gateway Intents**: deja los tres **desactivados**. El bot solo usa los intents no privilegiados
     `guilds` y `guildVoiceStates`; no necesita *Server Members* ni *Message Content*.
5. Activa el Modo desarrollador en Discord (Ajustes de usuario > Avanzado), haz clic derecho en tu servidor y elige
   **Copiar ID del servidor**; pégalo en `ALLOWED_GUILD_IDS` (varios servidores: separados por comas).
6. Usa el enlace de instalación de la pestaña **Installation** (o genera uno en **OAuth2 > URL Generator** con los
   scopes `bot` y `applications.commands`) con estos permisos y añade el bot a tu servidor:
   - View Channel
   - Send Messages
   - Attach Files
   - Connect
   - Change Nickname (para mostrar `[GRABANDO]`; la grabación funciona igualmente sin él)

   Speak **no** hace falta: el bot solo escucha.

Si al bot le faltan Send Messages o Attach Files en un canal de texto, los archivos se guardan igualmente en disco y el
bot registra el fallo en el log.

### Restringe quién puede ejecutar `/grabar`

Por defecto, todo el mundo en un servidor permitido puede usar los comandos. Para limitarlo: **Ajustes del servidor >
Integraciones > (tu bot)**, selecciona `/grabar` y permite solo un rol o usuarios concretos (y deniega `@everyone`).
Discord lo aplica por sí mismo, así que el bot no necesita ninguna configuración de roles propia.

## Configuración (`.env`)

| Variable | Valor por defecto | Significado |
| --- | --- | --- |
| `DISCORD_TOKEN` | obligatorio | Token del bot |
| `DISCORD_APP_ID` | obligatorio | ID de la aplicación |
| `ALLOWED_GUILD_IDS` | obligatorio | IDs de los servidores que el bot puede atender, separados por comas (alias antiguo: `DISCORD_GUILD_ID`) |
| `SUMMARY_ENABLED` | `true` | `false` desactiva el resumen de Claude: el texto de la transcripción no se envía entonces a ninguna parte |
| `WHISPER_BIN` | `whisper-cli` | Binario de whisper.cpp (nombre en el `PATH` o ruta completa) |
| `WHISPER_MODEL` | `models/ggml-large-v3.bin` | Modelo de Whisper (`ggml-large-v3-turbo.bin` es más rápido y menos preciso) |
| `WHISPER_VAD_MODEL` | `models/ggml-silero-v5.1.2.bin` | Modelo VAD (si falta el archivo, no se usa VAD y se muestra un aviso) |
| `WHISPER_LANGUAGE` | `es` | Idioma hablado (`auto` para detectarlo). Solo cambia la transcripción: los mensajes del bot y el resumen siguen en español |
| `WHISPER_BEAM_SIZE` | `8` | Tamaño del beam y best-of (más alto es más lento y algo más preciso) |
| `WHISPER_PROMPT` | párrafo integrado en castellano | Prompt inicial para la puntuación y el vocabulario. Déjalo vacío para desactivarlo. Solo cambia la transcripción |
| `CLAUDE_BIN` | `claude` | CLI de Claude Code |
| `RECORDINGS_DIR` | `recordings` | Carpeta de salida |

Las rutas relativas se resuelven respecto al directorio de trabajo (la carpeta del proyecto cuando se ejecuta como
servicio).

## Ejecución

```sh
npm start
```

En un canal de voz, ejecuta `/grabar`; cuando termines, `/parar`. La grabación también se detiene sola cuando el canal
se queda vacío (tras 15 s), cuando el bot es movido o desconectado, cuando el cifrado de voz sigue fallando o cuando no
se oye a nadie durante los primeros 5 minutos.

### Ejecutar como servicio

Cada instalador genera una definición de servicio para el usuario actual, la arranca al iniciar sesión y la reinicia
si falla. Ejecuta antes `npm install` y crea `.env`. Los logs van a `logs/`.

| Sistema | Instalar | Desinstalar |
| --- | --- | --- |
| macOS (LaunchAgent de launchd, etiqueta `com.<usuario>.discord-scribe`) | `scripts/install-service-macos.sh` | `scripts/uninstall-service-macos.sh` |
| Linux (unidad de **usuario** de systemd `discord-scribe.service`) | `scripts/install-service-linux.sh` | `scripts/uninstall-service-linux.sh` |
| Windows (tarea programada al iniciar sesión) | `.\scripts\install-service-windows.ps1` | `.\scripts\uninstall-service-windows.ps1` |

Los instaladores de macOS y Linux aceptan `--dry-run` (Windows: `-DryRun`) para mostrar lo que instalarían sin cambiar
nada. Los instaladores fijan la ruta absoluta de `node` que encuentran en el momento de la instalación, así que vuelve
a ejecutarlos después de actualizar Node con un gestor de versiones. Notas:

- macOS: por defecto es un LaunchAgent, así que solo corre mientras tu sesión gráfica está abierta (se detiene al
  cerrarla). Para que sobreviva a los cierres de sesión y arranque con el equipo sin que nadie inicie sesión, usa el
  modo `--system` (más abajo).
- Linux: ejecuta `sudo loginctl enable-linger $USER` para que el servicio de usuario siga funcionando cuando cierres
  sesión.
- Windows: la tarea se reinicia cada minuto si falla. Windows no tiene `SIGTERM`, así que detener la tarea mata el bot
  sin su cierre ordenado (una grabación sin terminar se queda en `recordings/.work/`).
- Asegúrate de que `whisper-cli` y `claude` sean accesibles desde el `PATH` del servicio, o define `WHISPER_BIN` /
  `CLAUDE_BIN` con rutas completas en `.env`.

#### macOS: servicio de sistema y métricas

```sh
scripts/install-service-macos.sh --system --metrics   # LaunchDaemon + muestreo de recursos
scripts/uninstall-service-macos.sh --system           # desinstalar (quita también el muestreador)
```

- `--system` instala un LaunchDaemon en `/Library/LaunchDaemons`: sobrevive a los cierres de sesión y arranca con el
  equipo. Ejecuta el script como tu usuario normal, nunca como root: el bot corre con tu usuario (así encuentra tu
  configuración de `claude`) y el script llama a `sudo` solo para los pasos privilegiados. Al cambiar de modo elimina
  la instancia del otro, para no ejecutar el bot dos veces.
- Si el proyecto está en un disco externo, macOS no lo monta al arrancar hasta que alguien inicia sesión. Actívalo una
  vez con `sudo defaults write /Library/Preferences/SystemConfiguration/autodiskmount AutomountDisksWithoutUserLogin
  -bool true`. El servicio espera a que el volumen esté montado antes de arrancar.
- En modo `--system` los logs del servicio van a `~/Library/Logs/discord-scribe/`, en el disco de arranque: macOS no
  deja que launchd los cree en un disco externo y el servicio no llegaría a arrancar. Si el proyecto está en un disco
  externo y el bot no puede leerlo, concede a `node` acceso total al disco en Ajustes del Sistema → Privacidad y
  seguridad.
- `--metrics` añade un trabajo que cada 5 minutos anota en `logs/metrics.csv` la memoria y la CPU del bot, de
  `whisper-cli` y de `claude`. Consulta el resumen (24 h y 7 días: media, pico y último valor) con `npm run metrics`;
  usa `node scripts/service-metrics.mjs summary --window 90m` para otra ventana.
- El instalador admite `--dry-run` con cualquier combinación de opciones para ver los plist sin instalar nada.

## Salida

```
recordings/2026-10-04_1705-general/
  transcript.md   # [mm:ss] **Nombre**: texto, en orden cronológico, con las intervenciones consecutivas de una persona fusionadas
  summary.md      # resumen, decisiones, tareas pendientes con responsables (en español)
```

Los WAV por usuario se escriben en `recordings/.work/` mientras se graba y **se borran en cuanto se transcriben**. Si
falla la transcripción de un participante, su WAV se conserva para que puedas reintentarla a mano con `whisper-cli`. Si
falla el resumen, la transcripción se guarda y se publica igualmente, con un aviso. Cada ejecución de whisper tiene un
tiempo límite de max(10 min, 3x la duración del audio); al agotarse, el proceso se mata y se conserva el WAV de ese
participante. Los detalles de los errores van al log, nunca al chat.

Con `SIGTERM`/`SIGINT` (y `SIGBREAK` en Windows), el bot detiene las grabaciones activas, espera hasta 150 s a las
transcripciones en cola y después mata cualquier proceso hijo de whisper/claude que siga en ejecución. Lo que quede sin
procesar se queda en `recordings/.work/` (el log indica dónde). Discord limita los mensajes a 2000 caracteres; los
resúmenes largos se reparten en varios mensajes y la transcripción se adjunta al último.

## Cómo funciona

Arquitectura hexagonal, ejecutada directamente con `tsx` (sin paso de compilación):

| Capa | Ruta | Contenido |
| --- | --- | --- |
| Dominio | `src/domain` | configuración, control de acceso, ensamblador de pistas por usuario (búfer de reordenación, filtro de paquetes a cero, relleno de silencios, de 48 kHz a 16 kHz), cabecera WAV, fusión de transcripciones, utilidades de apodo y de recuperación |
| Aplicación | `src/app` | caso de uso `processRecording`, `SessionRecorder`, puertos (`Transcriber`, `Summarizer`, `OutputStore`, `ChatNotifier`) |
| Adaptadores | `src/adapters` | whisper-cli, claude-cli, sistema de archivos, decodificador Opus, ejecución de procesos compatible con Windows, Discord (Dysnomia) |
| Raíz de composición | `src/main.ts` | lo conecta todo a partir de `.env` |

La recepción de voz no es oficial en ninguna librería de Discord. Desde marzo de 2026, Discord exige voz con cifrado de
extremo a extremo DAVE, por lo que el bot usa el mismo stack que el grabador de producción
[Craig](https://github.com/CraigChat/craig): `@projectdysnomia/dysnomia` fijado a un commit, `@snazzah/davey` (DAVE),
`sodium-native` y `@discordjs/opus`. También aprovecha las lecciones de Craig: descartar los paquetes casi a cero,
reordenar los paquetes de cada usuario por su marca de tiempo RTP, detenerse cuando DAVE sigue invalidando transiciones
y reintentar las reconexiones de voz.

## Desarrollo

```sh
npx vitest run      # pruebas (TDD estricto: primero se prueban el dominio y los casos de uso)
npx tsc --noEmit    # comprobación de tipos
```

`npm install` activa `.githooks/pre-commit` (`git config core.hooksPath .githooks`). Se niega a hacer commit de archivos
`.env` y `.env.*` (salvo `.env.example`) y ejecuta `gitleaks` sobre los cambios añadidos al área de preparación cuando
está instalado (`brew install gitleaks`, o consulta la documentación de
[gitleaks](https://github.com/gitleaks/gitleaks#installing)); sin él, el hook solo avisa. La CI ejecuta las pruebas en
Ubuntu, macOS y Windows y analiza el historial con gitleaks.

## Solución de problemas

- **`Configuration problems`**: el mensaje enumera todos los valores de `.env` que faltan o no son válidos.
  `ALLOWED_GUILD_IDS` es obligatorio.
- **Los comandos de barra no aparecen**: se registran por servidor permitido al arrancar. Comprueba que el log muestre
  `Registered slash commands`, que el bot se añadiera con el scope `applications.commands` y que el ID de servidor de
  `ALLOWED_GUILD_IDS` sea correcto. Si el bot responde que no está autorizado, el servidor no está en la lista.
- **El bot ha abandonado mi servidor por sí solo**: el bot abandona todos los servidores cuyo ID no figura en
  `ALLOWED_GUILD_IDS` (el log dice `Leaving guild`). La causa habitual es una errata o un ID equivocado, por ejemplo al
  migrar desde el antiguo `DISCORD_GUILD_ID`. Para encontrar el ID correcto, activa el Modo desarrollador (ajustes de
  Discord, Avanzado), haz clic derecho en el servidor y elige **Copiar ID del servidor**. Pégalo en `ALLOWED_GUILD_IDS`
  dentro de `.env`, reinicia el bot y vuelve a invitarlo.
- **`Could not start whisper-cli`**: instala whisper.cpp o define `WHISPER_BIN` con su ruta completa.
- **La transcripción sale vacía o llena de "Gracias."**: falta el modelo VAD (mira el aviso al arrancar); ejecuta
  `npm run download-models`.
- **No hay resumen**: comprueba que `claude -p "hi"` funciona con el usuario que ejecuta el bot (los servicios se
  ejecutan como tú, pero con un `PATH` más reducido) y que `SUMMARY_ENABLED` no es `false`.
- **Aviso de Opus al arrancar**: no se pudo cargar el decodificador nativo y se está usando el más lento de WebAssembly.
  Funciona igualmente.
- **Windows y `claude.cmd`**: las CLI instaladas con npm son envoltorios `.cmd`; el bot los resuelve y escapa los
  argumentos para `cmd.exe` (los saltos de línea del prompt del resumen se convierten en espacios). Un `claude.exe`
  nativo se lanza directamente.

## Limitaciones conocidas

- Los scripts de instalación del servicio pueden fallar si la ruta del proyecto contiene `&`, `|` o `%` (y `<` o `&` en
  macOS, donde la ruta acaba en un plist). Solución: mueve el proyecto a una ruta sencilla antes de instalar el
  servicio.
- La recepción de voz no es oficial y puede romperse cuando Discord cambie su protocolo de voz (DAVE); si ocurre,
  actualiza Dysnomia y Davey.
- Una grabación por servidor a la vez; los trabajos de transcripción se ejecutan uno tras otro.
- Si el bot se cierra de forma abrupta a mitad de una grabación, los WAV de cada usuario se quedan en
  `recordings/.work/` y no se procesan automáticamente.
- Los scripts de servicio de Linux y Windows y la ruta de ejecución de procesos en Windows siguen el comportamiento
  documentado de esas plataformas; la CI cubre las pruebas y la comprobación de tipos en los tres sistemas, no una
  sesión real de Discord. Informa de los problemas que encuentres en tu plataforma.

## Licencia

[MIT](LICENSE)
