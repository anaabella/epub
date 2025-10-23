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

// --- Función de arranque asíncrona para manejar el webhook de forma segura ---
const start = async () => {
    try {
        const webhookUrl = `${url}/bot${token}`;
        // 1. Configurar el webhook y esperar la confirmación de Telegram
        await bot.setWebHook(webhookUrl);
        console.log(`¡Webhook configurado exitosamente en ${webhookUrl}!`);

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

// --- 4. Listeners (Escuchadores de Eventos) ---

// Responde al comando /start
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "¡Hola! Envíame un archivo .epub y lo limpiaré por ti, usando todas las opciones de limpieza activadas.");
});

// Iniciar todo el proceso
start();

// Responde cuando alguien envía un documento
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const file = msg.document;

    // Verificar que es un .epub
    if (file.file_name && file.file_name.endsWith('.epub')) {
        try {
            await bot.sendMessage(chatId, `Procesando "${file.file_name}"... por favor espera. Esto puede tardar un momento.`);
            
            // --- INICIO DE CAMBIO: Método de descarga robusto ---
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
            const options = {
                removeImages: true,
                removeGoogle: true,
                fixPunctuation: true,
                fixSpacing: true,
                removeEmptyP: true,
                removeStyles: true
            };
            
            const processedBuffer = await processEpubBuffer(fileBuffer, options);

            // 3. Enviar el archivo de vuelta
            const newFileName = file.file_name.replace('.epub', '_limpio.epub');
            await bot.sendDocument(chatId, processedBuffer, {}, {
                filename: newFileName,
                contentType: 'application/epub+zip'
            });
            console.log(`Archivo ${newFileName} enviado a ${chatId}.`);

        } catch (err) {
            console.error(err);
            if (err.name === 'AbortError') {
                await bot.sendMessage(chatId, 'Lo siento, la descarga del archivo tardó demasiado y se canceló. Intenta con un archivo más pequeño o revisa la conexión del servidor.');
            }
            // Manejamos el error específico de Telegram para archivos grandes
            if (err.message && err.message.includes('file is too big')) {
                await bot.sendMessage(chatId, 'Lo siento, el archivo es demasiado grande para ser procesado por el bot.');
            } else {
                await bot.sendMessage(chatId, `Lo siento, ocurrió un error al procesar tu archivo: ${err.message}`);
            }
        }
    } else {
        await bot.sendMessage(chatId, "Por favor, envíame un archivo que termine en .epub");
    }
});

// Ya no necesitamos la función downloadFileBuffer, así que la eliminamos.

// --- 5. Lógica de Procesamiento (Adaptada de la PWA) ---

/**
 * Procesa un buffer de archivo .epub y aplica las opciones de limpieza.
 * @param {Buffer} buffer - El contenido del archivo .epub.
 * @param {object} options - Las opciones de limpieza.
 * @returns {Promise<Buffer>} - Un buffer con el .epub limpio.
 */
async function processEpubBuffer(buffer, options) {
    const jszip = new JSZip();
    
    // Adaptación para Node.js: Necesitamos JSDOM para simular el DOM
    const { window } = new JSDOM('');
    const parser = new window.DOMParser();
    const serializer = new window.XMLSerializer();

    // 1. Cargar desde el Buffer
    console.log('Cargando y descomprimiendo el .epub...');
    const zip = await jszip.loadAsync(buffer);
    
    let imagesRemovedCount = 0;
    let filesModifiedCount = 0;
    const filePromises = [];
    const filesToRemove = [];

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
                        
                        // 1. Quitar etiquetas <img> y <image>
                        if (options.removeImages) {
                            const imgTags = doc.querySelectorAll('img');
                            const imageTags = doc.querySelectorAll('image');
                            if (imgTags.length > 0 || imageTags.length > 0) {
                                imgTags.forEach(img => img.remove());
                                imageTags.forEach(img => img.remove());
                                modified = true;
                            }
                        }

                        // 2. Quitar estilos en línea
                        if (options.removeStyles) {
                            doc.querySelectorAll('*').forEach(el => {
                                if (el.hasAttribute('style')) {
                                    el.removeAttribute('style');
                                    modified = true;
                                }
                            });
                        }

                        // 3. Quitar párrafos vacíos
                        if (options.removeEmptyP) {
                            doc.querySelectorAll('p').forEach(p => {
                                const textIsEmpty = p.textContent.trim() === '';
                                // Usamos firstElementChild en lugar de childElementCount
                                const hasNoElements = p.firstElementChild === null; 
                                
                                if (textIsEmpty && hasNoElements) {
                                    p.remove();
                                    modified = true;
                                }
                            });
                        }

                        // 4. Modificaciones de texto (TreeWalker)
                        if (options.removeGoogle || options.fixPunctuation || options.fixSpacing) {
                            if (doc.documentElement) {
                                // Usamos window.NodeFilter desde JSDOM
                                const walker = doc.createTreeWalker(doc.documentElement, window.NodeFilter.SHOW_TEXT, null, false);
                                let node;

                                const targetPhrase = "Machine Translated by Google";
                                const periodQuoteRegex = /\.["”]/g; 
                                const allQuotesRegex = /["'“”‘’«»]/g;

                                while (node = walker.nextNode()) {
                                    if (!node.nodeValue) continue;
                                    let newText = node.nodeValue;
                                    let textModified = false;
                                    
                                    if (options.removeGoogle && newText.includes(targetPhrase)) {
                                        newText = newText.replace(new RegExp(targetPhrase, 'g'), '');
                                        textModified = true;
                                    }
                                    if (options.fixPunctuation && periodQuoteRegex.test(newText)) {
                                        newText = newText.replace(periodQuoteRegex, ' —');
                                        textModified = true;
                                    }
                                    if (options.fixPunctuation && allQuotesRegex.test(newText)) {
                                        newText = newText.replace(allQuotesRegex, '—');
                                        textModified = true;
                                    }
                                    if (options.fixSpacing && newText.includes('  ')) {
                                        newText = newText.replace(/ +/g, ' ');
                                        textModified = true;
                                    }

                                    if (textModified) {
                                        node.nodeValue = newText;
                                        modified = true;
                                    }
                                }
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
                    }
                })()
            );
        }
    });

    // 3. Esperar a que todos los archivos de texto se procesen
    await Promise.all(filePromises);

    // 4. Eliminar los archivos de imagen marcados
    filesToRemove.forEach(name => zip.remove(name));

    console.log(`Proceso completado: ${imagesRemovedCount} imágenes quitadas, ${filesModifiedCount} archivos modificados.`);
    
    // 5. Generar como Buffer para Node.js
    return zip.generateAsync({ type: 'nodebuffer' });
}
