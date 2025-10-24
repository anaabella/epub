// --- 1. Importaciones ---
const TelegramBot = require('node-telegram-bot-api');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom'); // Para DOMParser y XMLSerializer en Node.js
const express = require('express'); // Importar Express para el servidor web
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');


// --- 2. Configuración del Token ---

// ¡NO PONGAS TU CLAVE AQUÍ! Lee la variable de entorno que configuraste.
const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WEBHOOK_URL; // La URL pública de tu servidor
const port = process.env.PORT || 3000; // El puerto en el que escuchará el servidor

if (!token || !url) {
    console.error('Error: Faltan variables de entorno.');
    if (!token) {
        console.error('La variable de entorno TELEGRAM_BOT_TOKEN no está configurada.');
        console.log('Ejemplo (Linux/macOS): export TELEGRAM_BOT_TOKEN="12345:ABC..."');
    }
    if (!url) {
        console.error('La variable de entorno WEBHOOK_URL no está configurada.');
        console.log('Ejemplo (Linux/macOS): export WEBHOOK_URL="https://mi-bot.replit.dev"');
    }
    process.exit(1);
}

// --- Logging ---
const logEvent = async (message) => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;
    console.log(logMessage.trim()); // También imprimir en consola
    await fs.appendFile('bot.log', logMessage).catch(e => console.error('Error al escribir en el log:', e));
};

// --- 3. Inicializar el Bot ---
const bot = new TelegramBot(token);
const app = express();
// Middleware para parsear el JSON que envía Telegram
app.use(express.json());

// --- Limpieza de Caché ---
const cleanCache = async () => {
    const cacheDir = './cache';
    try {
        await fs.mkdir(cacheDir, { recursive: true });
        const files = await fs.readdir(cacheDir);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 horas

        for (const file of files) {
            const filePath = path.join(cacheDir, file);
            const stat = await fs.stat(filePath);
            if (now - stat.mtime.getTime() > maxAge) {
                await fs.unlink(filePath);
                logEvent(`Cache: Eliminado archivo antiguo "${file}".`);
            }
        }
    } catch (e) {
        logEvent(`Error al limpiar el caché: ${e.message}`);
    }
};

// --- Configuración de la Base de Datos (lowdb) y opciones por defecto ---
const adapter = new JSONFile('db.json');
const db = new Low(adapter, {}); // Provide default data (an empty object)

// --- Función de arranque asíncrona para manejar el webhook de forma segura ---
const start = async () => {
    try {
        // Cargar la base de datos desde el archivo.
        await db.read();
        // Si el archivo no existe o está vacío, inicializar la estructura. También para userDefaultOptions
        db.data ||= { userStates: {} };
        await db.write();

        // Limpiar el caché al iniciar
        await cleanCache();

        // Aseguramos que no haya dobles barras si la URL ya termina con una.
        const webhookUrl = `${url.replace(/\/$/, '')}/bot${token}`;
        // 1. Configurar el webhook y esperar la confirmación de Telegram
        await bot.setWebHook(webhookUrl);
        console.log(`¡Webhook configurado exitosamente en ${webhookUrl}!`);
        logEvent('Bot iniciado y webhook configurado.');

        // Registrar los comandos para que aparezcan en el menú de Telegram
        await bot.setMyCommands([
            { command: 'start', description: 'Inicia la conversación' },
            { command: 'limpiar', description: 'Personaliza las opciones de limpieza' },
            { command: 'reemplazar', description: 'Añade reglas para el próximo libro' },
            { command: 'metadata', description: 'Edita los metadatos del próximo libro (título, autor)' },
            { command: 'css', description: 'Inyecta CSS personalizado en el próximo libro' }, // Nuevo comando
            { command: 'diccionario', description: 'Gestiona tus diccionarios de reemplazo persistentes' },
            { command: 'help', description: 'Muestra la ayuda detallada' },
        ]);
        logEvent('Comandos registrados en Telegram.');

        // 2. Configurar la ruta que escuchará a Telegram
        app.post(`/bot${token}`, (req, res) => {
            // Este log es para confirmar que los mensajes llegan
            console.log('¡Petición recibida en el webhook!');
            bot.processUpdate(req.body);
            res.sendStatus(200); // Respondemos a Telegram que todo está bien
        });

        // 3. Iniciar el servidor Express
        app.listen(port, () => {
            console.log(`Servidor Express escuchando en el puerto ${port}`);
            logEvent(`Servidor Express escuchando en el puerto ${port}.`);
        });

    } catch (error) {
        // Si setWebHook falla, este bloque se ejecutará
        logEvent(`ERROR CRÍTICO AL CONFIGURAR EL WEBHOOK: ${error.message}`);
        process.exit(1); // Detenemos el bot para que el error sea visible
    }
};


// Opciones de limpieza por defecto para nuevos usuarios.
const defaultOptions = {
    removeImages: true,
    removeGoogle: true,
    fixPunctuation: true,
    fixSpacing: true,
    removeEmptyP: true,
    removeStyles: true,
    translate: false,
    removeHyperlinks: false,
    removeFootnotes: false,
    optimizeImages: false // Nueva opción para optimizar imágenes
};

// Definir los motores de traducción disponibles
const TRANSLATION_ENGINES = [
    { id: 'google', name: 'Google Translate' },
    { id: 'deepl', name: 'DeepL' }
];

// Función para generar el teclado de opciones dinámicamente.
function generateOptionsKeyboard(options) {
    const getLabel = (key) => {
        const emoji = options[key] ? '✅' : '❌';
        switch (key) {
            case 'removeImages':   return `${emoji} Quitar imágenes`;
            case 'removeStyles':   return `${emoji} Quitar estilos`;
            case 'removeEmptyP':   return `${emoji} Quitar párrafos vacíos`;
            case 'removeGoogle':   return `${emoji} Quitar "Traducido por..."`;
            case 'fixPunctuation': return `${emoji} Corregir puntuación`;
            case 'fixSpacing':     return `${emoji} Corregir espaciado`;
            case 'removeHyperlinks': return `${emoji} Quitar hipervínculos`;
            case 'removeFootnotes': return `${emoji} Quitar notas al pie`;
            case 'optimizeImages': return `${emoji} Optimizar imágenes`;
            case 'translate':      return `${emoji} Traducir a Español`;
            case 'generateSummary': return `${emoji} Generar resumen con IA`;
            default:               return '';
        }
    };

    const currentEngine = TRANSLATION_ENGINES.find(e => e.id === options.translationEngine) || TRANSLATION_ENGINES[0];
    const currentOutputFormat = options.outputFormat || 'epub';

    return [
        [ { text: getLabel('removeImages'), callback_data: 'toggle_removeImages' } ],
        [ { text: getLabel('removeStyles'), callback_data: 'toggle_removeStyles' } ],
        [ { text: getLabel('removeEmptyP'), callback_data: 'toggle_removeEmptyP' } ],
        [ { text: getLabel('removeGoogle'), callback_data: 'toggle_removeGoogle' } ],
        [ { text: getLabel('fixPunctuation'), callback_data: 'toggle_fixPunctuation' } ],
        [ { text: getLabel('fixSpacing'), callback_data: 'toggle_fixSpacing' } ],
        [ { text: getLabel('removeHyperlinks'), callback_data: 'toggle_removeHyperlinks' } ],
        [ { text: getLabel('removeFootnotes'), callback_data: 'toggle_removeFootnotes' } ],
        [ { text: getLabel('optimizeImages'), callback_data: 'toggle_optimizeImages' } ],
        [ { text: getLabel('translate'), callback_data: 'toggle_translate' } ], // Keep this to enable/disable translation
        [ { text: getLabel('generateSummary'), callback_data: 'toggle_generateSummary' } ], // New button
        [ { text: 'Guardar como mis opciones por defecto', callback_data: 'save_default_options' } ], // Nuevo botón
        [ { text: `Cambiar motor de traducción: ${currentEngine.name}`, callback_data: 'cycle_translation_engine' } ], // New button
        [ { text: `Formato de salida: ${currentOutputFormat.toUpperCase()}`, callback_data: 'cycle_output_format' } ], // New button
        [ { text: 'Hecho. Ahora envía tu archivo.', callback_data: 'done_selecting' } ],
        [ { text: 'Resetear a valores por defecto', callback_data: 'reset_options' } ]
    ];
}


// --- 4. Listeners (Escuchadores de Eventos) ---

// Responde al comando /start
bot.onText(/\/start/, async (msg) => {
    try {
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) inició el bot.`);
        await bot.sendMessage(msg.chat.id, "¡Hola! Envíame un archivo .epub para limpiarlo. Usa /limpiar para personalizar las opciones, /reemplazar para añadir reglas de un solo uso, o /help para ver todo lo que puedo hacer.");
    } catch (err) {
        logEvent(`Error en /start para el chat ${msg.chat.id}: ${err.message}`);
    }
});

// --- Funciones de limpieza (importadas) ---
const { cleanImages, cleanStyles, cleanEmptyParagraphs, cleanHyperlinks, cleanFootnotes, cleanTextNodes } = require('./cleaners');

// --- Funciones de traducción y metadatos (existentes) ---


// Responde al comando /limpiar para mostrar las opciones
bot.onText(/\/limpiar/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        // Si el usuario no tiene estado, se lo creamos con las opciones por defecto.
        if (!db.data.userStates[chatId]) {
            // Cargar opciones por defecto del usuario si existen, de lo contrario usar las globales
            const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
            db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
            await db.write();
        }
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) usó /limpiar.`);


        const userOptions = db.data.userStates[chatId];
        await bot.sendMessage(chatId, 'Selecciona las opciones de limpieza que deseas aplicar:', {
            reply_markup: {
                inline_keyboard: generateOptionsKeyboard(userOptions)
            }
        });
    } catch (err) {
        logEvent(`Error en /limpiar para el chat ${msg.chat.id}: ${err.message}`);
    }
});

// Maneja las pulsaciones de los botones del teclado inline
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    try {
        // Si el usuario no tiene estado, lo inicializamos.
        if (!db.data.userStates[chatId]) {
            const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
            db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
            await db.write();
        }
        logEvent(`Usuario ${callbackQuery.from.id} (${callbackQuery.from.username || callbackQuery.from.first_name}) pulsó botón: ${data}.`);
        const userOptions = db.data.userStates[chatId];

        const toggleMatch = data.match(/^toggle_(\w+)$/);
        if (toggleMatch) {
            const optionKey = data.replace('toggle_', '');
            // Cambiamos el valor de la opción (true a false y viceversa)
            userOptions[optionKey] = !userOptions[optionKey];
            await db.write(); // Guardamos el cambio en la base de datos

            // Editamos el mensaje original con el teclado actualizado
            await bot.editMessageReplyMarkup({
                inline_keyboard: generateOptionsKeyboard(userOptions)
            }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        } else if (data === 'done_selecting') {
            // Eliminamos el teclado y confirmamos al usuario.
            logEvent(`Usuario ${callbackQuery.from.id} finalizó la selección de opciones.`);
            await bot.editMessageText('¡Opciones guardadas! Ahora puedes enviarme tu archivo .epub.', {
                chat_id: chatId,
                message_id: msg.message_id
            });
        } else if (data === 'reset_options') {
            // Reseteamos las opciones del usuario a los valores por defecto
            Object.assign(userOptions, defaultOptions);
            // También eliminamos sus opciones por defecto guardadas
            if (db.data.userDefaultOptions?.[chatId]) {
                delete db.data.userDefaultOptions[chatId];
            }
            await db.write();

            // Actualizamos el teclado para reflejar el cambio
            await bot.editMessageReplyMarkup({
                inline_keyboard: generateOptionsKeyboard(userOptions)
            }, { chat_id: chatId, message_id: msg.message_id });
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Opciones reseteadas' });
        } else if (data === 'save_default_options') {
            // Guardar las opciones actuales del usuario como sus opciones por defecto
            db.data.userDefaultOptions ||= {};
            db.data.userDefaultOptions[chatId] = { ...userOptions };
            // Asegurarse de no guardar las opciones temporales como singleUseReplacements, processingQueue, metadata
            delete db.data.userDefaultOptions[chatId].singleUseReplacements;
            delete db.data.userDefaultOptions[chatId].processingQueue;
            delete db.data.userDefaultOptions[chatId].metadata;
            await db.write();
            await bot.answerCallbackQuery(callbackQuery.id, { text: '¡Opciones guardadas como predeterminadas!' });
        } else if (data.startsWith('dict_')) {
            const parts = data.split('_');
            const action = parts[1];
            const dictName = parts.slice(2).join('_');

            if (action === 'toggle') {
                userOptions.activeDictionaries ||= [];
                const index = userOptions.activeDictionaries.indexOf(dictName);
                if (index > -1) {
                    userOptions.activeDictionaries.splice(index, 1);
                } else {
                    userOptions.activeDictionaries.push(dictName);
                }
                await db.write();
                await bot.editMessageReplyMarkup({ inline_keyboard: generateDictionaryKeyboard(chatId) }, { chat_id: chatId, message_id: msg.message_id });
            } else if (action === 'edit') {
                userOptions.isWaitingForDictionaryRules = true;
                userOptions.currentDictionaryName = dictName;
                await db.write();
                await bot.sendMessage(chatId, `Modo de edición para el diccionario "${dictName}". Añade más reglas en formato \`original,nueva\` o envía /fin para terminar.`);
                await bot.deleteMessage(chatId, msg.message_id);
            } else if (action === 'delete') {
                if (userOptions.userDictionaries?.[dictName]) {
                    delete userOptions.userDictionaries[dictName];
                    const index = userOptions.activeDictionaries.indexOf(dictName);
                    if (index > -1) userOptions.activeDictionaries.splice(index, 1);
                    await db.write();
                    await bot.answerCallbackQuery(callbackQuery.id, { text: `Diccionario "${dictName}" eliminado.` });
                    await bot.editMessageReplyMarkup({ inline_keyboard: generateDictionaryKeyboard(chatId) }, { chat_id: chatId, message_id: msg.message_id });
                }
            } else if (action === 'create') {
                userOptions.isWaitingForNewDictionaryName = true;
                await db.write();
                await bot.sendMessage(chatId, "Por favor, envía el nombre para tu nuevo diccionario.");
                await bot.deleteMessage(chatId, msg.message_id);
            } else if (action === 'close') {
                await bot.deleteMessage(chatId, msg.message_id);
            }
            await bot.answerCallbackQuery(callbackQuery.id);
        } else if (data === 'toggle_generateSummary') {
            userOptions.generateSummary = !userOptions.generateSummary;
            await db.write();
            await bot.editMessageReplyMarkup({
                inline_keyboard: generateOptionsKeyboard(userOptions)
            }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        } else if (data === 'cycle_output_format') {
            const formats = ['epub', 'mobi', 'pdf'];
            const currentIndex = formats.indexOf(userOptions.outputFormat);
            const nextIndex = (currentIndex + 1) % formats.length;
            userOptions.outputFormat = formats[nextIndex];
            await db.write();

            await bot.editMessageReplyMarkup({
                inline_keyboard: generateOptionsKeyboard(userOptions)
            }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        } else if (data === 'cycle_translation_engine') {
            // ... existing logic for translation engine
        }
    } catch (err) {
        // Si algo falla (ej: el mensaje ya no existe), lo capturamos aquí.
        logEvent(`Error en callback_query para el chat ${chatId}: ${err.message}`);
        // Opcional: notificar al usuario que algo salió mal con el botón.
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Hubo un error al procesar esta acción.',
            show_alert: true
        });
    }

});


// Responde al comando /help
bot.onText(/\/help/, async (msg) => {
    try {
        const helpMessage = "¡Hola! Soy un bot que limpia archivos .epub.\n" +
                            "Cuando me envías un archivo, realizo las siguientes acciones automáticamente:\n\n" +
                            "*COMANDOS PRINCIPALES*\n" +
                            "- `/limpiar`: Personaliza las opciones de limpieza y formato de salida.\n" +
                            "- `/reemplazar`: Permite definir reglas de reemplazo para el próximo libro.\n\n" +
                            "*🧹 OPCIONES DE LIMPIEZA*\n" +
                            "- `/metadata`: Edita el título y autor del próximo libro.\n\n" +
                            "*🌐 SITIOS WEB SOPORTADOS*\n" + "Actualmente, puedo descargar historias de Wattpad, Archive of Our Own (AO3), FanFiction.net, Tumblr y Twitter/X.\n\n" +
                            "- *Elimino imágenes:* Quito todas las imágenes (jpg, png, etc.) para reducir el tamaño del archivo.\n" +
                            "- *Elimino estilos:* Borro todos los estilos en línea (colores, tamaños de fuente, etc.) para un formato más limpio.\n" +
                            "- *Elimino párrafos vacíos:* Quito los párrafos que no contienen texto ni elementos.\n\n" +
                            "- *Elimino hipervínculos:* Quito todos los enlaces (etiquetas `<a>`) del texto, dejando solo el texto del enlace.\n\n" +
                            "- *Optimizo imágenes:* Comprimo las imágenes para reducir el tamaño del archivo sin eliminarlas.\n\n" +
                            "- *Elimino notas al pie:* Busco y elimino las referencias a notas al pie y las propias notas.\n\n" +
                            "- `/diccionario`: Gestiona tus diccionarios de reemplazo persistentes.\n\n" +
                            "*✍️ OPCIONES DE CORRECCIÓN*\n" +
                            "- *Elimino \"Traducido por Google\":* Busco y elimino la frase \"Machine Translated by Google\".\n" +
                            "- *Corrijo puntuación de diálogos:* Reemplazo comillas (' \" “ ” « ») y puntos seguidos de comillas (\".\") por guiones largos (—).\n" +
                            "- *Corrijo espaciado:* Reemplazo múltiples espacios seguidos por uno solo.";
        const translationHelp = "\n*🌐 TRADUCCIÓN Y RESUMEN IA AUTOMÁTICO*\n" +
                            "Si el libro no está en español, lo traduciré automáticamente. Puedes cambiar el motor de traducción (Google, DeepL, etc.) en el menú de `/limpiar`. También puedes activar la generación de un resumen con IA.\n\n" +
                            "Para ver tus opciones actuales, usa el comando `/limpiar` y mira el teclado de opciones.";
        await bot.sendMessage(msg.chat.id, helpMessage + translationHelp, { parse_mode: 'Markdown' });
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) usó /help.`);
    } catch (err) {
        logEvent(`Error en /help para el chat ${msg.chat.id}: ${err.message}`);
    }
});

// Comando para iniciar el modo de reemplazo de un solo uso
bot.onText(/\/reemplazar/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        if (!db.data.userStates[chatId]) {
            const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
            db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
            await db.write();
        }
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) inició /reemplazar.`);



        db.data.userStates[chatId].isWaitingForReplacements = true;
        await db.write();
        const message = `
Estás en modo de reemplazo para el próximo libro.

Envíame un mensaje con las reglas, una por línea. El formato es:
` + '`palabra_original,palabra_nueva`' + `

Por ejemplo:
` + '`Capitulo,Capítulo`' + `
` + '`Sr.,Señor`' + `

Estas reglas se aplicarán *solo al siguiente .epub que envíes*.
    `;
        await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    } catch (err) {
        logEvent(`Error en /reemplazar para el chat ${msg.chat.id}: ${err.message}`);
    }
});

// Comando para iniciar el modo de edición de metadatos
bot.onText(/\/metadata/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        if (!db.data.userStates[chatId]) {
            const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
            db.data.userStates[chatId] = {
                ...userDefault,
                singleUseReplacements: [],
                processingQueue: []
            };
        }
        db.data.userStates[chatId].isWaitingForMetadata = true;
        db.data.userStates[chatId].metadata = {}; // Initialize metadata object
        await db.write();
        await bot.sendMessage(chatId, "Modo de edición de metadatos activado. Por favor, envía el nuevo título del libro.");
    } catch (err) {
        console.error(`Error en /metadata para el chat ${msg.chat.id}:`, err.message);
    }
});

// Comando para inyectar CSS personalizado
bot.onText(/\/css/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        if (!db.data.userStates[chatId]) {
            const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
            db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
            await db.write();
        }
        db.data.userStates[chatId].isWaitingForCss = true;
        await db.write();
        await bot.sendMessage(chatId, "Modo de inyección de CSS activado. Envíame el bloque de código CSS que quieres inyectar en el próximo libro.");
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) inició /css.`);
    } catch (err) {
        logEvent(`Error en /css para el chat ${msg.chat.id}: ${err.message}`);
    }
});


function generateDictionaryKeyboard(chatId) {
    const userState = db.data.userStates?.[chatId];
    const dictionaries = userState?.userDictionaries || {};
    const activeDictionaries = userState?.activeDictionaries || [];
    const keyboard = [];

    if (Object.keys(dictionaries).length > 0) {
        for (const dictName in dictionaries) {
            const isActive = activeDictionaries.includes(dictName);
            const statusEmoji = isActive ? '✅' : '☑️';
            keyboard.push([
                { text: `${statusEmoji} ${dictName}`, callback_data: `dict_toggle_${dictName}` },
                { text: '✏️ Editar', callback_data: `dict_edit_${dictName}` },
                { text: '🗑️ Eliminar', callback_data: `dict_delete_${dictName}` }
            ]);
        }
    } else {
        keyboard.push([{ text: "No tienes diccionarios guardados.", callback_data: "no_op" }]);
    }

    keyboard.push([{ text: '➕ Crear nuevo diccionario', callback_data: 'dict_create' }]);
    keyboard.push([{ text: '🔙 Volver a Limpieza', callback_data: 'dict_close_and_clean' }, { text: '❌ Cerrar', callback_data: 'dict_close' }]);
    return keyboard;
}

bot.onText(/\/diccionario$/, async (msg) => {
    const chatId = msg.chat.id;
    logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) usó /diccionario.`);
    const keyboard = generateDictionaryKeyboard(chatId);
    await bot.sendMessage(chatId, "Gestiona tus diccionarios de reemplazo:", {
        reply_markup: { inline_keyboard: keyboard }
    });
});

// Comandos para gestionar diccionarios de reemplazo persistentes
bot.onText(/\/diccionario crear (.+)/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const dictName = match[1].trim();
        db.data.userStates ||= {};
        if (!db.data.userStates[chatId]) {
            db.data.userStates[chatId] = {
                ...defaultOptions,
                singleUseReplacements: [],
                processingQueue: []
            };
        }
        db.data.userStates[chatId].userDictionaries ||= {};
        if (db.data.userStates[chatId].userDictionaries[dictName]) {
            await bot.sendMessage(chatId, `Ya existe un diccionario con el nombre "${dictName}".`);
            return;
        }
        db.data.userStates[chatId].isWaitingForDictionaryRules = true;
        db.data.userStates[chatId].currentDictionaryName = dictName;
        await db.write();
        await bot.sendMessage(chatId, `Creando diccionario "${dictName}". Envía las reglas, una por línea, en formato \`original,nueva\`. Envía /fin para terminar.`);
    } catch (err) {
        console.error(`Error en /diccionario crear para el chat ${msg.chat.id}:`, err.message);
    }
});

bot.onText(/\/diccionario activar (.+)/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const dictName = match[1].trim();
        db.data.userStates ||= {};
        if (!db.data.userStates[chatId] || !db.data.userStates[chatId].userDictionaries?.[dictName]) {
            await bot.sendMessage(chatId, `No existe un diccionario con el nombre "${dictName}".`);
            return;
        }
        db.data.userStates[chatId].activeDictionaries ||= [];
        if (!db.data.userStates[chatId].activeDictionaries.includes(dictName)) {
            db.data.userStates[chatId].activeDictionaries.push(dictName);
            await db.write();
            await bot.sendMessage(chatId, `Diccionario "${dictName}" activado para los próximos procesamientos.`);
        } else {
            await bot.sendMessage(chatId, `Diccionario "${dictName}" ya está activo.`);
        }
    } catch (err) {
        console.error(`Error en /diccionario activar para el chat ${msg.chat.id}:`, err.message);
    }
});

bot.onText(/\/diccionario desactivar (.+)/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const dictName = match[1].trim();
        if (!db.data.userStates?.[chatId]?.activeDictionaries) {
            await bot.sendMessage(chatId, `Diccionario "${dictName}" no estaba activo.`);
            return;
        }
        const index = db.data.userStates[chatId].activeDictionaries.indexOf(dictName);
        if (index > -1) {
            db.data.userStates[chatId].activeDictionaries.splice(index, 1);
            await db.write();
            await bot.sendMessage(chatId, `Diccionario "${dictName}" desactivado. Ya no se aplicará.`);
            logEvent(`Usuario ${msg.from.id} desactivó diccionario "${dictName}".`);
        } else {
            await bot.sendMessage(chatId, `Diccionario "${dictName}" no estaba activo.`);
        }
    } catch (err) {
        logEvent(`Error en /diccionario desactivar para el chat ${msg.chat.id}: ${err.message}`);
    }
});

bot.onText(/\/diccionario listar/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userState = db.data.userStates?.[chatId];
        logEvent(`Usuario ${msg.from.id} (${msg.from.username || msg.from.first_name}) usó /diccionario listar.`);
        if (!userState || !userState.userDictionaries || Object.keys(userState.userDictionaries).length === 0) {
            await bot.sendMessage(chatId, "No tienes diccionarios guardados.");
            return;
        }
        let message = "*Tus diccionarios guardados:*\n";
        for (const dictName in userState.userDictionaries) {
            const isActive = userState.activeDictionaries?.includes(dictName) ? " (activo)" : "";
            message += `- ${dictName} (${userState.userDictionaries[dictName].length} reglas)${isActive}\n`;
        }
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
        logEvent(`Error en /diccionario listar para el chat ${msg.chat.id}: ${err.message}`);
    }
});

bot.onText(/\/fin/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        if (db.data.userStates?.[chatId]?.isWaitingForDictionaryRules) {
            db.data.userStates[chatId].isWaitingForDictionaryRules = false;
            delete db.data.userStates[chatId].currentDictionaryName;
            await db.write();
            await bot.sendMessage(chatId, "Modo de creación de diccionario finalizado.");
            // Mostrar el menú de diccionarios de nuevo
            const keyboard = generateDictionaryKeyboard(chatId);
            await bot.sendMessage(chatId, "Gestiona tus diccionarios:", {
                reply_markup: { inline_keyboard: keyboard }
            });
            logEvent(`Usuario ${msg.from.id} finalizó creación/edición de diccionario.`);
        }
    } catch (err) {
        logEvent(`Error en /fin para el chat ${msg.chat.id}: ${err.message}`);
    }
});

/**
 * Centraliza el manejo de errores para los listeners del bot.
 * @param {Error} err - El objeto de error.
 * @param {number} chatId - El ID del chat donde ocurrió el error.
 * @param {TelegramBot.Message} [statusMessage] - Mensaje de estado opcional para borrar.
 */
async function handleError(err, chatId, statusMessage) {
    logEvent(`Error en el chat ${chatId}: ${err.message || err}`);

    if (err.name === 'AbortError') {
        await bot.sendMessage(chatId, 'Lo siento, la descarga del archivo tardó demasiado y se canceló. Intenta con un archivo más pequeño o revisa la conexión del servidor.');
    } else if (err.message && err.message.includes('file is too big')) {
        await bot.sendMessage(chatId, 'Lo siento, el archivo es demasiado grande para ser procesado por el bot.');
    } else if (err.message && err.message.includes('Cannot read from')) {
        await bot.sendMessage(chatId, 'Lo siento, no pude procesar el enlace. Asegúrate de enviar solo la URL de Wattpad, sin texto adicional.');
    } else {
        await bot.sendMessage(chatId, `Lo siento, ocurrió un error inesperado: ${err.message}`);
    }

    if (statusMessage && statusMessage.message_id) {
        try {
            await bot.deleteMessage(chatId, statusMessage.message_id);
        } catch (e) {
            // It's possible the message was already deleted or doesn't exist.
            // We can ignore 'message to delete not found' errors.
            if (!e.message.includes('message to delete not found')) {
                logEvent(`Advertencia: No se pudo borrar el mensaje de estado tras un error: ${e.message}`);
            }
        }
    }
}

const runShellCommand = (command, args = []) => new Promise((resolve, reject) => {
    const child = require('child_process').spawn(command, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Command failed with code ${code}: ${stdout}`)));
});

// --- 5. Listeners de Contenido ---
// Función para añadir un trabajo a la cola de procesamiento del usuario
async function addJobToQueue(chatId, job) {
    db.data.userStates ||= {};
    if (!db.data.userStates[chatId]) {
        const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
        db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
    }
    db.data.userStates[chatId].processingQueue ||= [];
    const userQueue = db.data.userStates[chatId].processingQueue;

    userQueue.push(job);
    await db.write();
    await bot.sendMessage(chatId, `"${job.originalFileName}" añadido a la cola de procesamiento. Posición: ${userQueue.length}.`);
    logEvent(`Chat ${chatId}: Añadido "${job.originalFileName}" a la cola. Posición: ${userQueue.length}.`);
            let lastProgressText = '';
            const onProgress = async (text) => {
                if (text === lastProgressText) return;
                // Asegurarse de que statusMessage y sus IDs de chat/mensaje sean válidos antes de intentar editar.
                if (statusMessage && statusMessage.message_id && statusMessage.chat && statusMessage.chat.id) {
                    try {
                        await bot.editMessageText(text, { chat_id: statusMessage.chat.id, message_id: statusMessage.message_id });
                        lastProgressText = text;
                    } catch (e) {
                        if (!e.message.includes('message is not modified')) {
                            console.warn('No se pudo editar el mensaje de progreso:', e.message);
                        }
                    }
                }
                // Si statusMessage no es válido, registrar el progreso en la consola en lugar de editar un mensaje inexistente.
                else { logEvent(`Progreso (sin mensaje de estado válido): ${text}`); } // This log is for debugging, won't be used in queue
            };

    processUserQueue(chatId); // Iniciar procesamiento si no está ya en marcha
}

// Función para enviar el archivo procesado al usuario
async function sendProcessedFile(chatId, processedBuffer, wasTranslated, bookSummary, originalFileName, options, statusMessage) {
    const outputFormat = options.outputFormat || 'epub';
    let finalBuffer = processedBuffer;
    let finalFileNameBase = path.basename(originalFileName, path.extname(originalFileName));
    let finalFileName;

    if (outputFormat !== 'epub') {
        await bot.editMessageText(`Convirtiendo a ${outputFormat.toUpperCase()}...`, { chat_id: statusMessage.chat.id, message_id: statusMessage.message_id });
        const tempDir = './temp';
        await fs.mkdir(tempDir, { recursive: true });
        const tempEpubPath = path.join(tempDir, `${finalFileNameBase}_temp.epub`);
        const tempOutputPath = path.join(tempDir, `${finalFileNameBase}_temp.${outputFormat}`);

        await fs.writeFile(tempEpubPath, processedBuffer);

        try {
            await runShellCommand('ebook-convert', [tempEpubPath, tempOutputPath]);
            finalBuffer = await fs.readFile(tempOutputPath);
            finalFileName = `${finalFileNameBase}_${wasTranslated ? 'traducido' : 'limpio'}.${outputFormat}`;
        } catch (error) { // Error en la conversión final
            console.error(`Error en la conversión a ${outputFormat.toUpperCase()}:`, error);
            throw new Error(`No se pudo convertir el archivo a ${outputFormat.toUpperCase()}.`);
        } finally {
            await fs.unlink(tempEpubPath).catch(e => console.warn(`No se pudo borrar el archivo temporal: ${tempEpubPath}`, e));
            await fs.unlink(tempOutputPath).catch(e => console.warn(`No se pudo borrar el archivo temporal: ${tempOutputPath}`, e));
        }
    } else {
        finalFileName = `${finalFileNameBase}_${wasTranslated ? 'traducido' : 'limpio'}.epub`;
    }

    let contentType = `application/${outputFormat}`;
    if (outputFormat === 'mobi') contentType = 'application/x-mobipocket-ebook';
    else if (outputFormat === 'pdf') contentType = 'application/pdf';

    await bot.sendDocument(chatId, finalBuffer, {}, {
        filename: finalFileName,
        contentType: contentType
    });

    if (bookSummary) {
        logEvent(`Chat ${chatId}: Resumen IA generado para "${originalFileName}".`);
        await bot.sendMessage(chatId, `*Resumen del libro:*\n\n${bookSummary}`, { parse_mode: 'Markdown' });
    }
    await bot.deleteMessage(chatId, statusMessage.message_id);
    logEvent(`Chat ${chatId}: Archivo "${finalFileName}" enviado.`);
}

/**
 * Crea un archivo de receta de FanFicFare para una URL específica.
 * @param {string} url - La URL de la historia a descargar.
 * @param {string} recipePath - La ruta donde se guardará el archivo .recipe.
 */
async function createFanFicFareRecipe(url, recipePath) {
    const recipeContent = `
from calibre.web.recipes.fanfictionnet import FanFictionNetSite
class GeneratedRecipe(FanFictionNetSite):
    def __init__(self, *args):
        FanFictionNetSite.__init__(self, *args)
        self.story_url = '${url}'
`;
    await fs.writeFile(recipePath, recipeContent.trim());
}
// --- Funciones para la cola de procesamiento ---
const userProcessingStatus = {}; // Para rastrear si un usuario está procesando actualmente

async function processUserQueue(chatId) {
    if (userProcessingStatus[chatId]) {
        return; // Ya procesando para este usuario
    }
    userProcessingStatus[chatId] = true;

    try {
        while (db.data.userStates[chatId] && db.data.userStates[chatId].processingQueue.length > 0) {
            const job = db.data.userStates[chatId].processingQueue.shift();
            await db.write(); // Guardar el estado de la cola

            let statusMessage = await bot.sendMessage(chatId, `Iniciando procesamiento para "${job.originalFileName}" (en cola)...`);
            let lastProgressText = '';
            const onProgress = async (text) => {
                if (text === lastProgressText) return;
                if (statusMessage && statusMessage.message_id && statusMessage.chat && statusMessage.chat.id) {
                    try {
                        await bot.editMessageText(text, { chat_id: statusMessage.chat.id, message_id: statusMessage.message_id });
                        lastProgressText = text;
                    } catch (e) {
                        if (!e.message.includes('message is not modified')) {
                            console.warn('No se pudo editar el mensaje de progreso:', e.message);
                        }
                    }
                } else { logEvent(`Progreso (sin mensaje de estado válido): ${text}`); }
            };

            try {
                let fileBuffer;
                let originalFileName = job.originalFileName;

                if (job.type === 'file') {
                    fileBuffer = Buffer.from(job.fileBuffer.data); // Re-create buffer from JSON data
                } else if (job.type === 'url') {
                    const cacheDir = './cache';
                    await fs.mkdir(cacheDir, { recursive: true });
                    const urlHash = crypto.createHash('sha256').update(job.url).digest('hex');
                    const cachedFilePath = path.join(cacheDir, `${urlHash}.epub`);

                    try {
                        // Intentar leer desde el caché primero
                        fileBuffer = await fs.readFile(cachedFilePath);
                        logEvent(`Cache: Encontrado y usando archivo en caché para la URL: ${job.url}`);
                        await onProgress('Usando versión en caché...');
                    } catch (e) {
                        // Si no está en caché, descargar
                        logEvent(`Cache: No se encontró archivo en caché. Descargando desde: ${job.url}`);
                        const tempDir = './temp';
                        const recipeDir = './recipes';
                        await fs.mkdir(tempDir, { recursive: true });
                        await fs.mkdir(recipeDir, { recursive: true });

                        const tempEpubPath = path.join(tempDir, `download_${Date.now()}.epub`);
                        const recipePath = path.join(recipeDir, `recipe_${Date.now()}.recipe`);
                        
                        await onProgress(`Descargando historia de ${new URL(job.url).hostname}...`);
                        await createFanFicFareRecipe(job.url, recipePath);
                        await runShellCommand('ebook-convert', [recipePath, tempEpubPath, '--verbose']);
                        fileBuffer = await fs.readFile(tempEpubPath);
                        
                        // Guardar en caché para futuras solicitudes
                        await fs.writeFile(cachedFilePath, fileBuffer);
                        await Promise.all([
                            fs.unlink(tempEpubPath).catch(e => console.warn(`No se pudo borrar el archivo temporal: ${tempEpubPath}`, e)),
                            fs.unlink(recipePath).catch(e => console.warn(`No se pudo borrar el archivo de receta: ${recipePath}`, e))
                        ]);
                    }
                    
                    // Intentar extraer el título del EPUB descargado para un nombre de archivo más descriptivo
                    try {
                        const zip = await new JSZip().loadAsync(fileBuffer);
                        const opfFile = Object.values(zip.files).find(file => file.name.endsWith('.opf'));
                        const opfContent = await opfFile.async('string');
                        const storyTitleMatch = opfContent.match(/<dc:title>(.*?)<\/dc:title>/);
                        if (storyTitleMatch && storyTitleMatch[1]) {
                            originalFileName = `${storyTitleMatch[1].replace(/[/\\?%*:|"<>]/g, '-')}.epub`; // Limpiar nombre de archivo
                        }
                    } catch (e) { console.warn("No se pudo leer el título del EPUB, se usará un nombre genérico."); }
                }

                const [processedBuffer, wasTranslated, bookSummary] = await processEpubBuffer(fileBuffer, job.options, onProgress);
                await sendProcessedFile(chatId, processedBuffer, wasTranslated, bookSummary, originalFileName, job.options, statusMessage);

                // Limpiar reemplazos de un solo uso y metadatos después de un procesamiento exitoso
                const userState = db.data.userStates[chatId];
                if (userState) {
                    if (userState.singleUseReplacements) userState.singleUseReplacements = [];
                    if (userState.customCss) userState.customCss = '';
                    if (userState.metadata) userState.metadata = {};
                    await db.write();
                }

            } catch (err) {
                handleError(err, chatId, statusMessage);
            }
        }
    } finally {
        userProcessingStatus[chatId] = false;
        await db.write(); // Asegurar que el estado final de la cola se guarde
    }
}

// --- 5. Listeners de Contenido ---

// Responde cuando alguien envía un documento
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const file = msg.document;

    db.data.userStates ||= {};
    if (!db.data.userStates[chatId]) { // Cargar opciones por defecto del usuario si existen
        const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
        db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
    }
    logEvent(`Chat ${chatId}: Documento recibido - "${file.file_name}".`);
    const userOptions = db.data.userStates[chatId];

    const allowedExtensions = ['.epub', '.pdf', '.mobi', '.azw3', '.txt'];
    const fileExtension = path.extname(file.file_name).toLowerCase();

    if (file.file_name && allowedExtensions.includes(fileExtension)) {
        let statusMessage, onProgress = async () => {};
        try {
            statusMessage = await bot.sendMessage(chatId, `Descargando "${file.file_name}"...`);
            const fileDetails = await bot.getFile(file.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${token}/${fileDetails.file_path}`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minutos de timeout

            const response = await fetch(fileUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Error al descargar el archivo: ${response.statusText}.`);
            }

            const arrayBuffer = await response.arrayBuffer();
            let fileBuffer = Buffer.from(arrayBuffer);
            // Intentar obtener el título del libro para un nombre de archivo más descriptivo
            let originalFileName = file.file_name;

            // Definir onProgress aquí para que esté disponible en este scope
            let lastProgressText = '';
            onProgress = async (text) => {
                if (text === lastProgressText) return;
                if (statusMessage && statusMessage.message_id && statusMessage.chat && statusMessage.chat.id) {
                    try {
                        await bot.editMessageText(text, { chat_id: statusMessage.chat.id, message_id: statusMessage.message_id });
                        lastProgressText = text;
                    } catch (e) {
                        if (!e.message.includes('message is not modified')) console.warn('No se pudo editar el mensaje de progreso:', e.message);
                    }
                } else { logEvent(`Progreso (sin mensaje de estado válido): ${text}`); }
            };

            if (fileExtension !== '.epub') { // Convertir a EPUB si no lo es
                await onProgress(`Convirtiendo ${fileExtension.toUpperCase()} a EPUB...`);
                const tempDir = './temp';
                await fs.mkdir(tempDir, { recursive: true });
                const inputPath = path.join(tempDir, file.file_name);
                const epubPath = inputPath.replace(fileExtension, '.epub');

                await fs.writeFile(inputPath, fileBuffer);

                try { // Este bloque maneja la conversión de PDF, MOBI, AZW3, TXT a EPUB
                    await runShellCommand('ebook-convert', [inputPath, epubPath]);
                    fileBuffer = await fs.readFile(epubPath);
                    originalFileName = originalFileName.replace(fileExtension, '.epub');
                } catch (error) {
                    console.error(`Error en la conversión de ${fileExtension.toUpperCase()} a EPUB:`, error);
                    throw new Error(`No se pudo convertir el archivo ${fileExtension.toUpperCase()} a EPUB. Asegúrate de que Calibre esté instalado.`);
                } finally {
                    await fs.unlink(inputPath).catch(e => console.warn(`No se pudo borrar el archivo temporal: ${inputPath}`, e));
                    await fs.unlink(epubPath).catch(e => console.warn(`No se pudo borrar el archivo temporal: ${epubPath}`, e));
                }
            }

            // Clonar las opciones para el trabajo, excluyendo las propiedades de estado que causan la referencia circular.
            const {
                processingQueue, profiles, isWaitingForCss, isWaitingForDictionaryRules,
                isWaitingForMetadata, isWaitingForNewDictionaryName, isWaitingForProfileName,
                isWaitingForReplacements, currentDictionaryName,
                ...jobOptions
            } = userOptions;

            const job = {
                type: 'file',
                fileBuffer: fileBuffer.toJSON(), // Convertir Buffer a formato serializable
                originalFileName: originalFileName,
                options: { ...jobOptions, chatId } // Usar las opciones limpias y añadir chatId
            };
            await addJobToQueue(chatId, job);

        } catch (err) {
            handleError(err, chatId, statusMessage);
            logEvent(`Chat ${chatId}: Error al procesar documento "${file.file_name}": ${err.message}`);
        }
    } else {
        await bot.sendMessage(chatId, "Por favor, envíame un archivo con una extensión soportada: .epub, .pdf, .mobi, .azw3, .txt.");
    }
});

// Responde a enlaces de Wattpad, Archive of Our Own y FanFiction.net
const wattpadUrlRegex = /https?:\/\/(www\.)?wattpad\.com\/(?:story\/)?(\d+)/;
const ao3UrlRegex = /https?:\/\/(www\.)?archiveofourown\.org\/works\/(\d+)/;
const fanfictionNetUrlRegex = /https?:\/\/(www\.)?fanfiction\.net\/s\/(\d+)/;
const tumblrUrlRegex = /https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.)?tumblr\.com\/(?:[a-zA-Z0-9\-]+\/)?(\d+)/; // Regex para posts de Tumblr, más flexible
const twitterUrlRegex = /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-zA-Z0-9_]+\/status\/(\d+)/; // Regex para posts de Twitter/X

async function handleUrlInput(msg, url) {
    const chatId = msg.chat.id;
    db.data.userStates ||= {};
    if (!db.data.userStates[chatId]) { // Cargar opciones por defecto del usuario si existen
        const userDefault = db.data.userDefaultOptions?.[chatId] || defaultOptions;
        db.data.userStates[chatId] = { ...userDefault, singleUseReplacements: [], processingQueue: [] };
    }
    logEvent(`Chat ${chatId}: URL recibida - "${url}".`);
    const userOptions = db.data.userStates[chatId];

    // Clonar las opciones para el trabajo, excluyendo las propiedades de estado que causan la referencia circular.
    const {
        processingQueue, profiles, isWaitingForCss, isWaitingForDictionaryRules,
        isWaitingForMetadata, isWaitingForNewDictionaryName, isWaitingForProfileName,
        isWaitingForReplacements, currentDictionaryName,
        ...jobOptions
    } = userOptions;

    const job = {
        type: 'url',
        url: url,
        originalFileName: new URL(url).hostname, // Nombre temporal, se actualizará al descargar
        options: { ...jobOptions, chatId } // Usar las opciones limpias y añadir chatId
    };
    await addJobToQueue(chatId, job);
}

bot.onText(wattpadUrlRegex, async (msg, match) => {
    await handleUrlInput(msg, match[0]);
});

bot.onText(ao3UrlRegex, async (msg, match) => {
    await handleUrlInput(msg, match[0]);
});

bot.onText(fanfictionNetUrlRegex, async (msg, match) => {
    await handleUrlInput(msg, match[0]);
});

bot.onText(tumblrUrlRegex, async (msg, match) => {
    await handleUrlInput(msg, match[0]);
});

bot.onText(twitterUrlRegex, async (msg, match) => {
    await handleUrlInput(msg, match[0]);
});

// Listener para mensajes de texto (para capturar las reglas de reemplazo)
// Este listener debe ir al FINAL para no interferir con los comandos.
bot.onText(/.*/, async (msg) => {
    const chatId = msg.chat.id;
    logEvent(`Chat ${chatId}: Mensaje de texto recibido - "${msg.text}".`);
    const userState = db.data.userStates?.[chatId];

    // Ignorar si es un comando, ya que tienen sus propios listeners (onText con regex específicas)
    if (msg.text.startsWith('/')) {
        return;
    }

    try {
        if (userState?.isWaitingForReplacements) {
            const lines = msg.text.split('\n').filter(line => line.trim() !== '');
            const replacements = [];

            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const original = parts[0].trim();
                    const replacement = parts.slice(1).join(',').trim();
                    if (original) {
                        replacements.push({ original, replacement });
                    }
                }
            }

            userState.singleUseReplacements = replacements;
            userState.isWaitingForReplacements = false; // Salir del modo de espera
            await db.write();

            await bot.sendMessage(chatId, `✅ ¡${replacements.length} reglas de reemplazo guardadas para el próximo libro! Ahora, envía tu archivo.`);
            logEvent(`Chat ${chatId}: ${replacements.length} reglas de reemplazo de un solo uso guardadas.`);
        } else if (userState?.isWaitingForMetadata) {
            if (!userState.metadata.title) {
                userState.metadata.title = msg.text.trim();
                await db.write();
                await bot.sendMessage(chatId, "Título guardado. Ahora, por favor, envía el nombre del autor.");
            } else {
                userState.metadata.author = msg.text.trim();
                userState.isWaitingForMetadata = false; // Salir del modo de espera
                await db.write();
                await bot.sendMessage(chatId, `✅ ¡Metadatos guardados para el próximo libro!\n- Título: ${userState.metadata.title}\n- Autor: ${userState.metadata.author}\n\nAhora, envía tu archivo.`);
                logEvent(`Chat ${chatId}: Metadatos guardados - Título: "${userState.metadata.title}", Autor: "${userState.metadata.author}".`);
            }
        } else if (userState?.isWaitingForDictionaryRules) {
            const lines = msg.text.split('\n').filter(line => line.trim() !== '');
            const dictName = userState.currentDictionaryName;
            if (!dictName) return;

            userState.userDictionaries ||= {};
            userState.userDictionaries[dictName] ||= [];

            let rulesAdded = 0;
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const original = parts[0].trim();
                    const replacement = parts.slice(1).join(',').trim();
                    if (original) {
                        userState.userDictionaries[dictName].push({ original, replacement });
                        rulesAdded++;
                    }
                }
            }
            await db.write();
            await bot.sendMessage(chatId, `✅ ¡${rulesAdded} reglas añadidas al diccionario "${dictName}"! Envía más reglas o /fin para terminar.`);
            logEvent(`Chat ${chatId}: ${rulesAdded} reglas añadidas al diccionario "${dictName}".`);
        }
    } catch (err) {
        logEvent(`Chat ${chatId}: Error al procesar mensaje de texto: ${err.message}`);
    }
});

// --- Graceful Shutdown ---
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach(signal => {
    process.on(signal, () => {
        console.log(`\nRecibida señal ${signal}. Cerrando el bot...`);
        // En modo webhook, no necesitamos detener el sondeo.
        // Simplemente cerramos el proceso del servidor, y el orquestador (Render) lo manejará.
        console.log('Servidor cerrándose. Saliendo.');
        process.exit(0);
    });
});

/**
 * Traduce el contenido de un documento HTML a español.
 * @param {Document} doc - El documento DOM a traducir.
 * @param {object} window - El objeto window de JSDOM.
 * @returns {Promise<boolean>} - `true` si se realizó la traducción, de lo contrario `false`.
 * Crea un archivo de configuración de traducción para Calibre.
 * @param {string} configPath - La ruta donde se guardará el archivo .json.
 * @param {object} options - Las opciones del usuario, que incluyen el motor y la clave API.
 */
async function translateDocument(doc, window, options) {
    const textToTranslate = [];
    const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue.trim()) {
            textToTranslate.push(node);
        }
    }
async function createTranslationConfig(configPath, options) {
    const selectedEngine = options.translationEngine || 'google';
    let apiKey = null;

    if (textToTranslate.length === 0) {
        return false;
    if (selectedEngine === 'deepl') {
        apiKey = process.env.DEEPL_KEY;
        if (!apiKey) throw new Error('La clave de API de DeepL (DEEPL_KEY) no está configurada.');
    }
    // Añadir más motores si es necesario

    // Unimos todos los textos para una única llamada a la API
    const originalTexts = textToTranslate.map(node => node.nodeValue);
    const combinedText = originalTexts.join('\n---\n');
    const config = {
        "translate_html_with_google": true,
        "google_translate_source": "auto",
        "google_translate_target": "es",
        "google_translate_api_key": selectedEngine === 'deepl' ? apiKey : null, // Calibre usa este campo para la clave de DeepL
        "google_translate_engine": selectedEngine
    };

    try {
        const selectedEngine = options.translationEngine || 'google';
        const translateOptions = { to: 'es', engine: selectedEngine };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

        let apiKey = null;
        if (selectedEngine === 'deepl') {
            apiKey = process.env.DEEPL_KEY;
            if (!apiKey) throw new Error('DeepL API key (DEEPL_KEY) is not set in environment variables.');
        } else if (selectedEngine === 'yandex') {
            apiKey = process.env.YANDEX_KEY;
            if (!apiKey) throw new Error('Yandex API key (YANDEX_KEY) is not set in environment variables.');
        }
        if (apiKey) {
            translateOptions.key = apiKey;
        }
async function getTitleFromOPF(zip) {
    // ... (función existente, no se muestra para brevedad)
}

        // The translation process aims to maintain the original HTML structure
        // by only replacing the text content of nodes.
        // Visual formatting (styles) might be affected if the 'removeStyles'
        // option is enabled, as it removes inline CSS.
        // Use dynamic import for ES Modules like 'translate'
        const translate = (await import('translate')).default;
        const translatedText = await translate(combinedText, translateOptions);
        const translatedParts = translatedText.split('\n---\n');

        if (originalTexts.length === translatedParts.length) {
            textToTranslate.forEach((node, index) => {
                node.nodeValue = translatedParts[index];
            });
            return true;
        }
    } catch (error) {
        // Si el error es por "Too many requests", es un error de la API de traducción, no del bot.
        if (error.message.includes('Too many requests')) {
            throw new Error('El servicio de traducción está sobrecargado. Por favor, inténtalo de nuevo más tarde.');
        }
        console.error('Error inesperado durante la traducción:', error);
    }

/**
 * Traduce el contenido de un documento HTML a español.
 * @param {Document} doc - El documento DOM a traducir.
 * @param {object} window - El objeto window de JSDOM.
 * @returns {Promise<boolean>} - `true` si se realizó la traducción, de lo contrario `false`.
 */
async function translateDocument(doc, window, options) {
    return false;
}

/**
 * Obtiene el idioma del libro desde el archivo .opf.
 * @param {JSZip} zip - El objeto zip del .epub.
 * @returns {Promise<string|null>} - El código de idioma (ej. 'en') o null si no se encuentra.
 */
async function getLanguageFromOPF(zip) {
    const opfFile = Object.values(zip.files).find(file => file.name.endsWith('.opf'));
    if (opfFile) {
        const content = await opfFile.async('string');
        const match = content.match(/<dc:language>(.*?)<\/dc:language>/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

/**
 * Detects the language from the text content of the EPUB.
 * @param {JSZip} zip - The zip object of the EPUB.
 * @returns {Promise<string|null>} - The ISO 639-3 language code (e.g., 'spa') or null.
 */
async function detectLanguageFromContent(zip) {
    const { franc } = await import('franc'); // Dynamic import for franc
    let sampleText = '';
    const textFiles = Object.values(zip.files).filter(file => /\.(html|xhtml)$/i.test(file.name));

    // Get text from a few files to build a decent sample size
    for (let i = 0; i < Math.min(textFiles.length, 5); i++) {
        try {
            const content = await textFiles[i].async('string');
            // A simple way to strip HTML tags for a quick analysis
            const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            sampleText += text + ' ';
            if (sampleText.length > 5000) break; // Stop if we have enough text
        } catch (e) {
            console.warn(`Could not read ${textFiles[i].name} for language detection.`);
        }
    }

    if (sampleText.trim()) {
        // franc returns ISO 639-3 codes. 'spa' is for Spanish.
        const langCode = franc(sampleText);
        return langCode;
    }

    return null;
}

// --- 7. Lógica de Procesamiento (Adaptada de la PWA) ---

/**
 * Procesa un buffer de archivo .epub y aplica las opciones de limpieza.
 * @param {Buffer} buffer - El contenido del archivo .epub.
 * @param {object} options - Las opciones de limpieza.
 * @returns {Promise<Buffer>} - Un buffer con el .epub limpio.
 */
async function processEpubBuffer(buffer, options, onProgress = async () => {}) {
async function processEpubBuffer(initialBuffer, options, onProgress = async () => {}) {
    const jszip = new JSZip();
    
    // Adaptación para Node.js: Necesitamos JSDOM para simular el DOM
    const { window } = new JSDOM('');
    const parser = new window.DOMParser();
    const serializer = new window.XMLSerializer();
    
    // 1. Cargar desde el Buffer
    await onProgress('Paso 1/4: Descomprimiendo el .epub...');
    console.log('Cargando y descomprimiendo el .epub...');
    const zip = await jszip.loadAsync(buffer);
    logEvent(`Chat ${options.chatId}: Cargando y descomprimiendo el .epub...`);
    const zip = await jszip.loadAsync(initialBuffer);
    
    let imagesRemovedCount = 0;
    let filesModifiedCount = 0;
    const filePromises = [];
    const filesToRemove = [];
    const parsingErrors = [];
    let bookSummary = null;

    // --- Detección de idioma ---
    let shouldTranslate = true; // Por defecto, intentamos traducir.
    let shouldTranslate = options.translate; // Usar la opción del usuario
    await onProgress('Paso 2/4: Detectando idioma...');

    // 1. Intentar con los metadatos (más rápido)
    let lang = await getLanguageFromOPF(zip);
    console.log(`Idioma detectado en metadatos (OPF): ${lang}`);
    logEvent(`Chat ${options.chatId}: Idioma detectado en metadatos (OPF): ${lang}`);

    if (lang && lang.toLowerCase().startsWith('es')) { // Si los metadatos indican español
        shouldTranslate = false;
        console.log('El libro ya está en español (según metadatos). No se traducirá.');
        logEvent(`Chat ${options.chatId}: El libro ya está en español (según metadatos). No se traducirá.`);
    } else {
        // 2. Si los metadatos no son concluyentes, analizar el contenido (más fiable)
        lang = await detectLanguageFromContent(zip);
        console.log(`Idioma detectado en contenido (franc): ${lang}`);
        logEvent(`Chat ${options.chatId}: Idioma detectado en contenido (franc): ${lang}`);
        // 'spa' es el código ISO 639-3 para español de franc
        if (lang === 'spa') {
            shouldTranslate = false; // Si el contenido es español
            console.log('El libro ya está en español (según análisis de contenido). No se traducirá.');
            logEvent(`Chat ${options.chatId}: El libro ya está en español (según análisis de contenido). No se traducirá.`);
        }
    }
    logEvent(`Chat ${options.chatId}: Idioma detectado: ${lang}. ¿Traducir? ${shouldTranslate}.`);

    // --- Modificación de metadatos ---
    if (options.metadata && (options.metadata.title || options.metadata.author)) {
        // Intentar obtener el título y autor del OPF si no se proporcionaron
        if (!options.metadata.title) options.metadata.title = await getTitleFromOPF(zip);
        if (!options.metadata.author) options.metadata.author = await getAuthorFromOPF(zip);

        logEvent(`Chat ${options.chatId}: Aplicando metadatos personalizados - Título: "${options.metadata.title}", Autor: "${options.metadata.author}".`);

        await onProgress('Modificando metadatos...');
        if (await modifyMetadata(zip, options.metadata)) filesModifiedCount++;
    }

    await onProgress('Paso 3/4: Limpiando archivos de texto...');
    zip.forEach((relativePath, zipEntry) => {
        const isImage = /\.(jpe?g|png|gif|svg|webp)$/i.test(zipEntry.name);
        const isText = /\.(html|xhtml|xml)$/i.test(zipEntry.name);

        if (isImage) {
            if (options.removeImages) {
                // Marcar archivo de imagen para eliminación
                filesToRemove.push(zipEntry.name);
                imagesRemovedCount++;
            } else if (options.optimizeImages) {
                // Procesar imágenes para optimizarlas
                filePromises.push(
                    (async () => {
                        try {
                            const imageBuffer = await zipEntry.async('nodebuffer');
                            const optimizedBuffer = await sharp(imageBuffer).jpeg({ quality: 80 }).png({ quality: 80 }).webp({ quality: 80 }).toBuffer();
                            if (optimizedBuffer.length < imageBuffer.length) {
                                zip.file(zipEntry.name, optimizedBuffer);
                            }
                        } catch (e) {
                            logEvent(`Chat ${options.chatId}: No se pudo optimizar la imagen ${zipEntry.name}: ${e.message}`);
                        }
                    })()
                );
            }
        } else if (isText) {
            // Procesar archivos de texto
            filePromises.push(
                (async () => {
                    try {
                        const content = await zipEntry.async('string');
                        const doc = parser.parseFromString(content, 'application/xml');
                        
                        let modified = false;
                        
                        // Llamamos a las funciones de limpieza modulares
                        if (options.removeImages && cleanImages(doc)) modified = true;
                        if (options.removeStyles && cleanStyles(doc)) modified = true;
                        if (options.removeEmptyP && cleanEmptyParagraphs(doc)) modified = true;
                        if (options.removeHyperlinks && cleanHyperlinks(doc)) modified = true; // Nueva opción
                        if (options.removeFootnotes && cleanFootnotes(doc)) modified = true;
                        
                        // Opciones de limpieza de texto
                        const textOptions = {
                            removeGoogle: options.removeGoogle,
                            fixPunctuation: options.fixPunctuation,
                            fixSpacing: options.fixSpacing,
                            // Combine single-use and dictionary replacements
                            singleUseReplacements: options.singleUseReplacements || [],
                            userDictionaries: options.userDictionaries || {},
                            activeDictionaries: options.activeDictionaries || []
                        };
                        if (cleanTextNodes(doc, textOptions, window)) {
                            modified = true;
                            logEvent(`Chat ${options.chatId}: Limpieza de texto aplicada a ${zipEntry.name}.`);
                        }

                        // --- Traducción ---
                        if (shouldTranslate && options.translationEngine) { // Asegurarse de que hay un motor seleccionado
                            await onProgress('Traduciendo texto... (esto puede tardar)');
                            if (await translateDocument(doc, window, options)) {
                                modified = true;
                                logEvent(`Chat ${options.chatId}: Traducción aplicada a ${zipEntry.name}.`);
                            }
                        }

                        // 5. Si se hizo CUALQUIER modificación, guardar el archivo
                        if (modified) {
                            filesModifiedCount++;
                            const newContent = serializer.serializeToString(doc);
                            zip.file(zipEntry.name, newContent);
                        }
                    } catch (e) {
                        console.warn(`Error al parsear ${zipEntry.name}, omitiendo:`, e.message);
                        logEvent(`Chat ${options.chatId}: Advertencia - Error al parsear ${zipEntry.name}, omitiendo: ${e.message}`);
                        // Guardamos el nombre del archivo que falló para notificar al usuario.
                        parsingErrors.push(zipEntry.name); // Error de parseo
                    }
                })()
            );
        }
    });

    // Esperar a que todos los archivos de texto se procesen
    await Promise.all(filePromises);

    // 4. Eliminar los archivos de imagen marcados
    filesToRemove.forEach(name => zip.remove(name));
    
    let currentBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // --- Traducción con Calibre ---
    if (shouldTranslate && options.translationEngine) {
        await onProgress('Traduciendo con Calibre... (esto puede tardar)');
        logEvent(`Chat ${options.chatId}: Iniciando traducción con Calibre usando ${options.translationEngine}.`);

        const tempDir = './temp';
        await fs.mkdir(tempDir, { recursive: true });
        const inputPath = path.join(tempDir, `pre-translation_${Date.now()}.epub`);
        const outputPath = path.join(tempDir, `translated_${Date.now()}.epub`);
        const configPath = path.join(tempDir, `translate-config_${Date.now()}.json`);

        await fs.writeFile(inputPath, currentBuffer);
        await createTranslationConfig(configPath, options);

        try {
            await runShellCommand('ebook-convert', [inputPath, outputPath, '--read-config', configPath]);
            currentBuffer = await fs.readFile(outputPath);
            logEvent(`Chat ${options.chatId}: Traducción con Calibre completada.`);
        } finally {
            await Promise.all([fs.unlink(inputPath), fs.unlink(outputPath), fs.unlink(configPath)]).catch(e => logEvent(`Chat ${options.chatId}: Advertencia - No se pudieron borrar archivos temporales de traducción.`));
        }
    }

    // --- Generación de resumen con IA ---
    if (options.generateSummary) {
        logEvent(`Chat ${options.chatId}: Iniciando generación de resumen con IA.`);
        await onProgress('Generando resumen con IA...');
        bookSummary = await generateAISummary(zip);
    }

    // Si hubo errores de parseo, los notificamos.
    if (parsingErrors.length > 0) {
        logEvent(`Chat ${options.chatId}: Advertencia - No se pudieron procesar ${parsingErrors.length} archivos internos.`);
        await onProgress(`Proceso finalizado con advertencias. No se pudieron procesar los siguientes archivos internos:\n- ${parsingErrors.join('\n- ')}`); // Notificar al usuario
    }
    logEvent(`Chat ${options.chatId}: Proceso completado: ${imagesRemovedCount} imágenes quitadas, ${filesModifiedCount} archivos modificados.`);
    
    // 5. Generar como Buffer para Node.js
    await onProgress('Paso 4/4: Reempaquetando el archivo...');
    const finalBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    return [finalBuffer, shouldTranslate, bookSummary];
    return [currentBuffer, shouldTranslate, bookSummary];
}

start();