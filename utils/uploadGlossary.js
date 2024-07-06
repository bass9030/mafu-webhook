const fs = require('fs')
const deepl = require('deepl-node');
const path = require('path');
const appRoot = require('app-root-path').path;
require('dotenv').config({
    path: path.join(appRoot, '.env')
});

// const glossary = fs.readFileSync('./glossary.csv');

const translator = new deepl.Translator(process.env.DEEPL_API_KEY);

(async () => {
    let glossary_id = (await translator.listGlossaries())[0]?.glossaryId;
    
    if(!!glossary_id) await translator.deleteGlossary(glossary_id);

    await translator.createGlossaryWithCsv('mahook_glossary_rev_' + new Date().getTime(), 'ja', 'ko', './glossary.csv');
    console.log('upload done');
    let glossary = (await translator.listGlossaries());
    console.log(glossary);
})();

// console.log('uploading glossary...')
