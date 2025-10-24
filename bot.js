/*
    EJEMPLO DE BOT DE TELEGRAM PARA LIMPIAR EPUBS
    -------------------------------------------------
    
    CÓMO USARLO:
    1.  Asegúrate de tener Node.js instalado en tu PC o servidor.
    2.  Crea una carpeta para tu bot, entra en ella y corre:
        npm install node-telegram-bot-api jszip jsdom express
    3.  Guarda tus claves en variables de entorno. No las pegues en el código.
        En Linux/macOS: export TELEGRAM_BOT_TOKEN="TU_NUEVA_KEY_AQUI"
        En Windows: set TELEGRAM_BOT_TOKEN="TU_NUEVA_KEY_AQUI"
    4.  Si lo despliegas en un servicio como Replit o Heroku, necesitarás la URL pública.
        Guárdala también como variable de entorno.
        En Linux/macOS: export WEBHOOK_URL="https://tu-app.replit.dev"
        En Windows: set WEBHOOK_URL="https://tu-app.replit.dev"
    5.  Guarda este archivo como 'bot.js'.
    6.  Ejecútalo con: node bot.js
*/

// --- 1. Importaciones ---
const TelegramBot = require('node-telegram-bot-api');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom'); // Para DOMParser y XMLSerializer en Node.js
const express = require('express');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { franc } = require('franc');
const translate = require('translate');

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

// --- 3. Inicializar el Bot ---
const bot = new TelegramBot(token);
const app = express();
// Middleware para parsear el JSON que envía Telegram
app.use(express.json());

// --- Configuración de la Base de Datos (lowdb) ---
const adapter = new JSONFile('db.json');
const db = new Low(adapter, {}); // Provide default data (an empty object)

// --- Función de arranque asíncrona para manejar el webhook de forma segura ---
const start = async () => {
    try {
        // Cargar la base de datos desde el archivo.
        await db.read();
        // Si el archivo no existe o está vacío, inicializar la estructura.
        db.data ||= { userStates: {} };
        await db.write();

        const webhookUrl = `${url}/bot${token}`;
        // 1. Configurar el webhook y esperar la confirmación de Telegram
        await bot.setWebHook(webhookUrl);
        console.log(`¡Webhook configurado exitosamente en ${webhookUrl}!`);

        // Registrar los comandos para que aparezcan en el menú de Telegram
        await bot.setMyCommands([
            { command: 'start', description: 'Inicia la conversación' },
            { command: 'limpiar', description: 'Personaliza las opciones de limpieza' },
            { command: 'reemplazar', description: 'Añade reglas para el próximo libro' },
            { command: 'help', description: 'Muestra la ayuda detallada' },
        ]);
        console.log('Comandos registrados en Telegram.');

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
            console.log('Habla con tu bot en Telegram para probarlo.');
        });

    } catch (error) {
        // Si setWebHook falla, este bloque se ejecutará
        console.error('ERROR CRÍTICO AL CONFIGURAR EL WEBHOOK:', error.message);
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
    translate: false
};

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
            case 'translate':      return `${emoji} Traducir a Español`;
            default:               return '';
        }
    };

    return [
        [ { text: getLabel('removeImages'), callback_data: 'toggle_removeImages' } ],
        [ { text: getLabel('removeStyles'), callback_data: 'toggle_removeStyles' } ],
        [ { text: getLabel('removeEmptyP'), callback_data: 'toggle_removeEmptyP' } ],
        [ { text: getLabel('removeGoogle'), callback_data: 'toggle_removeGoogle' } ],
        [ { text: getLabel('fixPunctuation'), callback_data: 'toggle_fixPunctuation' } ],
        [ { text: getLabel('fixSpacing'), callback_data: 'toggle_fixSpacing' } ],
        [ { text: getLabel('translate'), callback_data: 'toggle_translate' } ],
        [ { text: 'Hecho. Ahora envía tu archivo.', callback_data: 'done_selecting' } ],
        [ { text: 'Resetear a valores por defecto', callback_data: 'reset_options' } ]
    ];
}


// --- 4. Listeners (Escuchadores de Eventos) ---

// Responde al comando /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "¡Hola! Envíame un archivo .epub para limpiarlo. Usa /limpiar para personalizar las opciones, /reemplazar para añadir reglas de un solo uso, o /help para ver todo lo que puedo hacer.");
});

// Responde al comando /limpiar para mostrar las opciones
bot.onText(/\/limpiar/, async (msg) => {
    const chatId = msg.chat.id;
    // Si el usuario no tiene estado, se lo creamos con las opciones por defecto.
    if (!db.data.userStates[chatId]) {
        db.data.userStates[chatId] = { ...defaultOptions, singleUseReplacements: [] };
        await db.write();
    }
    const userOptions = db.data.userStates[chatId];
    bot.sendMessage(chatId, 'Selecciona las opciones de limpieza que deseas aplicar:', {
        reply_markup: {
            inline_keyboard: generateOptionsKeyboard(userOptions)
        }
    });
});

// Maneja las pulsaciones de los botones del teclado inline
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;

    // Si el usuario no tiene estado, lo inicializamos.
    if (!db.data.userStates[chatId]) {
        db.data.userStates[chatId] = { ...defaultOptions, singleUseReplacements: [] };
        await db.write();
    }
    const userOptions = db.data.userStates[chatId];

    if (data.startsWith('toggle_')) {
        const optionKey = data.replace('toggle_', '');
        // Cambiamos el valor de la opción (true a false y viceversa)
        userOptions[optionKey] = !userOptions[optionKey];
        await db.write(); // Guardamos el cambio en la base de datos

        // Editamos el mensaje original con el teclado actualizado
        bot.editMessageReplyMarkup({
            inline_keyboard: generateOptionsKeyboard(userOptions)
        }, {
            chat_id: chatId,
            message_id: msg.message_id
        });
    } else if (data === 'done_selecting') {
        // Eliminamos el teclado y confirmamos al usuario.
        bot.editMessageText('¡Opciones guardadas! Ahora puedes enviarme tu archivo .epub.', {
            chat_id: chatId,
            message_id: msg.message_id
        });
    } else if (data === 'reset_options') {
        // Reseteamos las opciones del usuario a los valores por defecto
        userOptions.removeImages = defaultOptions.removeImages;
        userOptions.removeGoogle = defaultOptions.removeGoogle;
        userOptions.fixPunctuation = defaultOptions.fixPunctuation;
        userOptions.fixSpacing = defaultOptions.fixSpacing;
        userOptions.removeEmptyP = defaultOptions.removeEmptyP;
        userOptions.removeStyles = defaultOptions.removeStyles;
        userOptions.translate = defaultOptions.translate;

        // Actualizamos el teclado para reflejar el cambio
        bot.editMessageReplyMarkup({
            inline_keyboard: generateOptionsKeyboard(userOptions)
        }, { chat_id: chatId, message_id: msg.message_id });
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Opciones reseteadas' });
    }
});


// Responde al comando /help
bot.onText(/\/help/, (msg) => {
    const helpMessage = `
¡Hola! Soy un bot que limpia archivos .epub.
Cuando me envías un archivo, realizo las siguientes acciones automáticamente:

*COMANDOS PRINCIPALES*
- `/limpiar`: Abre un menú para activar o desactivar las opciones de limpieza.
- `/reemplazar`: Permite definir reglas de reemplazo para el próximo libro.

*🧹 OPCIONES DE LIMPIEZA*
- *Elimino imágenes:* Quito todas las imágenes (jpg, png, etc.) para reducir el tamaño del archivo.
- *Elimino estilos:* Borro todos los estilos en línea (colores, tamaños de fuente, etc.) para un formato más limpio.
- *Elimino párrafos vacíos:* Quito los párrafos que no contienen texto ni elementos.

*✍️ OPCIONES DE CORRECCIÓN*
- *Elimino "Traducido por Google":* Busco y elimino la frase "Machine Translated by Google".
- *Corrijo puntuación de diálogos:* Reemplazo comillas (' " “ ” « ») y puntos seguidos de comillas (.") por guiones largos (—).
- *Corrijo espaciado:* Reemplazo múltiples espacios seguidos por uno solo.
    `;
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
});

// Comando para iniciar el modo de reemplazo de un solo uso
bot.onText(/\/reemplazar/, async (msg) => {
    const chatId = msg.chat.id;
    if (!db.data.userStates[chatId]) {
        db.data.userStates[chatId] = { ...defaultOptions, singleUseReplacements: [] };
    }
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
    bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

// Iniciar todo el proceso
start();

// Listener para mensajes de texto (para capturar las reglas de reemplazo)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    // Solo actuar si es un mensaje de texto, no es un comando y el usuario está esperando reglas.
    if (!msg.text || msg.text.startsWith('/') || !db.data.userStates[chatId] || !db.data.userStates[chatId].isWaitingForReplacements) {
        // Si no se cumplen las condiciones, no hacemos nada y dejamos que otros listeners (como on 'document') actúen.
        return;
    }
    
    try {
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

        db.data.userStates[chatId].singleUseReplacements = replacements;
        db.data.userStates[chatId].isWaitingForReplacements = false; // Salir del modo de espera
        await db.write();

        await bot.sendMessage(chatId, `✅ ¡${replacements.length} reglas de reemplazo guardadas para el próximo libro! Ahora, envía tu archivo .epub.`);
    } catch (err) {
        await bot.sendMessage(chatId, `Ocurrió un error al procesar tus reglas: ${err.message}`);
    }
});

/**
 * Centraliza el manejo de errores para los listeners del bot.
 * @param {Error} err - El objeto de error.
 * @param {number} chatId - El ID del chat donde ocurrió el error.
 * @param {TelegramBot.Message} [statusMessage] - Mensaje de estado opcional para borrar.
 */
async function handleError(err, chatId, statusMessage) {
    console.error(`Error en el chat ${chatId}:`, err);

    if (err.name === 'AbortError') {
        await bot.sendMessage(chatId, 'Lo siento, la descarga del archivo tardó demasiado y se canceló. Intenta con un archivo más pequeño o revisa la conexión del servidor.');
    } else if (err.message && err.message.includes('file is too big')) {
        await bot.sendMessage(chatId, 'Lo siento, el archivo es demasiado grande para ser procesado por el bot.');
    } else {
        await bot.sendMessage(chatId, `Lo siento, ocurrió un error inesperado: ${err.message}`);
    }

    if (statusMessage) {
        await bot.deleteMessage(chatId, statusMessage.message_id).catch(e => console.warn('No se pudo borrar el mensaje de estado tras un error:', e.message));
    }
}

// Responde cuando alguien envía un documento
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const file = msg.document;

    // Ensure the main userStates object exists in the database.
    db.data.userStates ||= {};

    if (file.file_name && file.file_name.endsWith('.epub')) {
        // --- MANEJO DE ARCHIVO .EPUB ---
        // Guardaremos el mensaje de estado para poder editarlo o borrarlo.
        let statusMessage;
        try {
            statusMessage = await bot.sendMessage(chatId, `Iniciando proceso para "${file.file_name}"...`);

            // --- Función de callback para actualizar el progreso ---
            let lastProgressText = '';
            const onProgress = async (text) => {
                // Evitamos llamadas innecesarias a la API si el texto no ha cambiado.
                if (text === lastProgressText) return;
                try {
                    await bot.editMessageText(text, {
                        chat_id: chatId,
                        message_id: statusMessage.message_id
                    });
                    lastProgressText = text;
                } catch (e) {
                    // Ignoramos el error común "message is not modified"
                    if (!e.message.includes('message is not modified')) {
                        console.warn('No se pudo editar el mensaje de progreso:', e.message);
                    }
                }
            };
            
            // --- INICIO DE CAMBIO: Método de descarga robusto ---
            await onProgress('Descargando archivo...');
            // 1. Descargar el archivo usando fetch (más estable que getFileStream)
            
            // Primero, obtenemos los detalles del archivo
            const fileDetails = await bot.getFile(file.file_id);
            // Construimos la URL de descarga directa
            const fileUrl = `https://api.telegram.org/file/bot${token}/${fileDetails.file_path}`;

            // Añadimos un controlador para cancelar la descarga si tarda demasiado (timeout)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 segundos de timeout

            // Usamos fetch (nativo en Node.js 18+) para descargar
            const response = await fetch(fileUrl, { signal: controller.signal });
            clearTimeout(timeoutId); // Si la descarga funciona, limpiamos el timeout

            if (!response.ok) {
                throw new Error(`Error al descargar el archivo: ${response.statusText}`);
            }

            // Convertimos la respuesta en un ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            // Convertimos el ArrayBuffer a un Buffer de Node.js
            const fileBuffer = Buffer.from(arrayBuffer);
            // --- FIN DE CAMBIO ---

            console.log(`Archivo ${file.file_name} descargado.`);

            // 2. Procesar el archivo (con todas las opciones por defecto)
            // Usamos las opciones guardadas del usuario, o las por defecto si no ha configurado nada.
            if (!db.data.userStates[chatId]) {
                db.data.userStates[chatId] = { ...defaultOptions, singleUseReplacements: [] };
            }
            const options = db.data.userStates[chatId];
            const optionsCount = Object.values(options).filter(v => v).length;
            console.log(`Aplicando ${optionsCount} opciones de limpieza para el chat ${chatId}.`);


            const processedBuffer = await processEpubBuffer(fileBuffer, options, onProgress);

            // 3. Enviar el archivo de vuelta
            const newFileName = options.translate ? file.file_name.replace('.epub', '_traducido.epub') : file.file_name.replace('.epub', '_limpio.epub');
            await bot.sendDocument(chatId, processedBuffer, {}, {
                filename: newFileName,
                contentType: 'application/epub+zip'
            });

            // 4. Limpiar el mensaje de estado
            await bot.deleteMessage(chatId, statusMessage.message_id);

            // 5. Limpiar las reglas de un solo uso después de aplicarlas
            if (db.data.userStates[chatId] && db.data.userStates[chatId].singleUseReplacements) {
                db.data.userStates[chatId].singleUseReplacements = [];
                await db.write();
            }

            console.log(`Archivo ${newFileName} enviado a ${chatId}.`);

        } catch (err) {
            handleError(err, chatId, statusMessage);
        } finally {
            // Limpiamos las reglas de un solo uso, incluso si hubo un error.
            if (db.data.userStates[chatId] && db.data.userStates[chatId].singleUseReplacements.length > 0) {
                db.data.userStates[chatId].singleUseReplacements = [];
                await db.write();
            }
        }
    } else {
        await bot.sendMessage(chatId, "Por favor, envíame un archivo que termine en .epub.");
    }
});

// Ya no necesitamos la función downloadFileBuffer, así que la eliminamos.

// --- 6. Funciones de Limpieza Modulares ---

/**
 * Elimina las etiquetas <img> y <image> de un documento DOM.
 * @param {Document} doc - El documento DOM a limpiar.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanImages(doc) {
    const imgTags = doc.querySelectorAll('img');
    const imageTags = doc.querySelectorAll('image');
    if (imgTags.length === 0 && imageTags.length === 0) {
        return false;
    }
    imgTags.forEach(img => img.remove());
    imageTags.forEach(img => img.remove());
    return true;
}

/**
 * Elimina los atributos de estilo en línea de todos los elementos.
 * @param {Document} doc - El documento DOM a limpiar.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanStyles(doc) {
    const styledElements = doc.querySelectorAll('[style]');
    if (styledElements.length === 0) {
        return false;
    }
    styledElements.forEach(el => el.removeAttribute('style'));
    return true;
}

/**
 * Elimina los párrafos vacíos.
 * @param {Document} doc - El documento DOM a limpiar.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanEmptyParagraphs(doc) {
    const emptyParagraphs = Array.from(doc.querySelectorAll('p')).filter(p =>
        p.textContent.trim() === '' && p.firstElementChild === null
    );
    if (emptyParagraphs.length === 0) {
        return false;
    }
    emptyParagraphs.forEach(p => p.remove());
    return true;
}

/**
 * Realiza varias limpiezas en los nodos de texto usando un TreeWalker.
 * @param {Document} doc - El documento DOM a limpiar.
 * @param {object} options - Las opciones de limpieza específicas del texto.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanTextNodes(doc, options, window) {
    if (!doc.documentElement) return false;

    let modified = false;
    const walker = doc.createTreeWalker(doc.documentElement, window.NodeFilter.SHOW_TEXT, null, false);
    let node;

    const watermarks = [
        "Machine Translated by Google",
        "OceanoPDF.com"
    ];
    const periodQuoteRegex = /\.["”]/g;
    const allQuotesRegex = /["'“”‘’«»]/g;

    while (node = walker.nextNode()) {
        if (!node.nodeValue) continue;
        let newText = node.nodeValue;
        let textModified = false;

        if (options.removeGoogle) {
            for (const watermark of watermarks) {
                // Usamos un simple replaceAll para evitar problemas con caracteres especiales en la RegExp
                if (newText.includes(watermark)) {
                    newText = newText.replaceAll(watermark, '');
                    textModified = true;
                }
            }
        }
        if (options.fixPunctuation) {
            newText = newText.replace(periodQuoteRegex, ' —').replace(allQuotesRegex, '—');
            textModified = textModified || (newText !== node.nodeValue);
        }
        if (options.fixSpacing && newText.includes('  ')) {
            newText = newText.replace(/ +/g, ' ');
            textModified = true;
        }
        // Aplicar reglas de reemplazo personalizadas
        if (options.singleUseReplacements && options.singleUseReplacements.length > 0) {
            for (const rule of options.singleUseReplacements) {
                newText = newText.replace(new RegExp(rule.original, 'g'), rule.replacement);
            }
            textModified = textModified || (newText !== node.nodeValue);
        }

        if (textModified) {
            node.nodeValue = newText;
            modified = true;
        }
    }
    return modified;
}

/**
 * Traduce el contenido de un documento HTML a español.
 * @param {Document} doc - El documento DOM a traducir.
 * @param {object} window - El objeto window de JSDOM.
 * @returns {Promise<boolean>} - `true` si se realizó la traducción, de lo contrario `false`.
 */
async function translateDocument(doc, window) {
    const textToTranslate = [];
    const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeValue.trim()) {
            textToTranslate.push(node);
        }
    }

    if (textToTranslate.length === 0) {
        return false;
    }

    // Unimos todos los textos para una única llamada a la API
    const originalTexts = textToTranslate.map(node => node.nodeValue);
    const combinedText = originalTexts.join('\n---\n');

    try {
        const translatedText = await translate(combinedText, { to: 'es' });
        const translatedParts = translatedText.split('\n---\n');

        if (originalTexts.length === translatedParts.length) {
            textToTranslate.forEach((node, index) => {
                node.nodeValue = translatedParts[index];
            });
            return true;
        }
    } catch (error) {
        console.error('Error al traducir:', error);
    }

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

// --- 5. Lógica de Procesamiento (Adaptada de la PWA) ---

/**
 * Procesa un buffer de archivo .epub y aplica las opciones de limpieza.
 * @param {Buffer} buffer - El contenido del archivo .epub.
 * @param {object} options - Las opciones de limpieza.
 * @returns {Promise<Buffer>} - Un buffer con el .epub limpio.
 */
async function processEpubBuffer(buffer, options, onProgress = async () => {}) {
    const jszip = new JSZip();
    
    // Adaptación para Node.js: Necesitamos JSDOM para simular el DOM
    const { window } = new JSDOM('');
    const parser = new window.DOMParser();
    const serializer = new window.XMLSerializer();
    
    // 1. Cargar desde el Buffer
    await onProgress('Paso 1/4: Descomprimiendo el .epub...');
    console.log('Cargando y descomprimiendo el .epub...');
    const zip = await jszip.loadAsync(buffer);
    
    let imagesRemovedCount = 0;
    let filesModifiedCount = 0;
    const filePromises = [];
    const filesToRemove = [];
    const parsingErrors = [];

    // --- Detección de idioma ---
    let bookLanguage = null;
    if (options.translate) {
        await onProgress('Paso 2/4: Detectando idioma...');
        bookLanguage = await getLanguageFromOPF(zip);
        console.log(`Idioma detectado: ${bookLanguage}`);
        if (bookLanguage && bookLanguage.startsWith('es')) {
            options.translate = false; // No traducir si ya está en español
            console.log('El libro ya está en español. No se traducirá.');
        }
    }

    await onProgress('Paso 3/4: Limpiando archivos de texto...');
    // 2. Iterar sobre cada archivo en el zip
    zip.forEach((relativePath, zipEntry) => {
        const isImage = /\.(jpe?g|png|gif|svg|webp)$/i.test(zipEntry.name);
        const isText = /\.(html|xhtml|xml)$/i.test(zipEntry.name);

        if (isImage && options.removeImages) {
            // Marcar archivo de imagen para eliminación
            filesToRemove.push(zipEntry.name);
            imagesRemovedCount++;
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
                        
                        // Opciones de limpieza de texto
                        const textOptions = {
                            removeGoogle: options.removeGoogle,
                            fixPunctuation: options.fixPunctuation,
                            fixSpacing: options.fixSpacing,
                            singleUseReplacements: options.singleUseReplacements,
                        };
                        if (cleanTextNodes(doc, textOptions, window)) {
                            modified = true;
                        }

                        // --- Traducción ---
                        if (options.translate) {
                            await onProgress('Traduciendo texto...');
                            if (await translateDocument(doc, window)) {
                                modified = true;
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
                        // Guardamos el nombre del archivo que falló para notificar al usuario.
                        parsingErrors.push(zipEntry.name);
                    }
                })()
            );
        }
    });

    // 3. Esperar a que todos los archivos de texto se procesen
    await Promise.all(filePromises);

    // 4. Eliminar los archivos de imagen marcados
    filesToRemove.forEach(name => zip.remove(name));
    
    // Si hubo errores de parseo, los notificamos.
    if (parsingErrors.length > 0) {
        await onProgress(`Proceso finalizado con advertencias. No se pudieron procesar los siguientes archivos internos:\n- ${parsingErrors.join('\n- ')}`);
    }

    console.log(`Proceso completado: ${imagesRemovedCount} imágenes quitadas, ${filesModifiedCount} archivos modificados.`);
    
    // 5. Generar como Buffer para Node.js
    await onProgress('Paso 4/4: Reempaquetando el archivo...');
    return zip.generateAsync({ type: 'nodebuffer' });
}
