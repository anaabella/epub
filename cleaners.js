const { JSDOM } = require('jsdom'); // Necesario para NodeFilter

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
 * Elimina todos los hipervínculos (etiquetas <a>) de un documento DOM, dejando solo su texto.
 * @param {Document} doc - El documento DOM a limpiar.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanHyperlinks(doc) {
    const links = doc.querySelectorAll('a');
    if (links.length === 0) {
        return false;
    }
    links.forEach(link => link.replaceWith(link.textContent || '')); // Reemplaza el enlace con su texto
    return true;
}

/**
 * Elimina las referencias a notas al pie y las propias notas del documento.
 * @param {Document} doc - El documento DOM a limpiar.
 * @returns {boolean} - `true` si se realizaron cambios, de lo contrario `false`.
 */
function cleanFootnotes(doc) {
    // Las referencias a notas suelen tener epub:type="noteref"
    const noteRefs = doc.querySelectorAll('[epub\\:type="noteref"]');
    // El contenido de las notas suele tener epub:type="footnote" o "endnote"
    const footnotes = doc.querySelectorAll('[epub\\:type="footnote"], [epub\\:type="endnote"]');

    if (noteRefs.length === 0 && footnotes.length === 0) {
        return false;
    }

    noteRefs.forEach(ref => ref.remove());
    footnotes.forEach(note => note.remove());
    return true;
}

/**
 * Realiza varias limpiezas en los nodos de texto usando un TreeWalker.
 * @param {Document} doc - El documento DOM a limpiar.
 * @param {object} options - Las opciones de limpieza específicas del texto.
 * @param {Window} window - El objeto window de JSDOM.
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

    // Recopilar todas las reglas de reemplazo (de un solo uso y de diccionarios activos)
    let allReplacements = [...(options.singleUseReplacements || [])];
    if (options.activeDictionaries && options.userDictionaries) {
        options.activeDictionaries.forEach(dictName => {
            if (options.userDictionaries[dictName]) {
                allReplacements = allReplacements.concat(options.userDictionaries[dictName]);
            }
        });
    }

    while (node = walker.nextNode()) {
        if (!node.nodeValue) continue;
        let newText = node.nodeValue;
        let textModified = false;

        if (options.removeGoogle) {
            for (const watermark of watermarks) {
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
        if (allReplacements.length > 0) {
            const originalText = newText;
            for (const rule of allReplacements) {
                newText = newText.replaceAll(rule.original, rule.replacement);
            }
            if (newText !== originalText) {
                textModified = true;
            }
        }

        if (textModified) {
            node.nodeValue = newText;
            modified = true;
        }
    }
    return modified;
}

module.exports = {
    cleanImages,
    cleanStyles,
    cleanEmptyParagraphs,
    cleanHyperlinks,
    cleanFootnotes,
    cleanTextNodes
};