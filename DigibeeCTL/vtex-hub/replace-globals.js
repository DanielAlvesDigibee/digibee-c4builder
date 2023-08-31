const fs = require("fs");
const path = require("path");
const util = require("util");

async function replaceGlobals() {
    try {
        //Read globals file and create dictionary
        const globalsFile = path.join(__dirname, "data/globals.json");
        let globalsDict = [];

        const data = await fs.readFileSync(globalsFile, "utf8");

        JSON.parse(data).data.globals.forEach((global) => {
            globalsDict[global.field] = JSON.parse(global.valuesByEnv);
        });

        await generateFiles(globalsDict);
        return true;
    } catch (err) {
        console.error(`Failed to replace globals.\nMessage: ${err.message.toString()}\nStack: ${err.stack.toString()}`);
        return false;
    }
}

function generateFiles(globalsDict) {
    //Make folder if not exist
    const environments = ["test", "prod"];
    const flowspecsFolder = path.join(__dirname, "data/flowspecs/");
    const globalsReplacedFolder = flowspecsFolder + "globals-replaced/";
    environments.forEach((environment) => {
        if (!fs.existsSync(`${globalsReplacedFolder}${environment}/`)) {
            fs.mkdirSync(`${globalsReplacedFolder}${environment}/`, { recursive: true });
        }
    });

    //Read all flowspecs and replace globals from dictionary
    const pattern = /\{\{global\.([^\}]+)\}\}/g;
    const files = fs.readdirSync(flowspecsFolder);

    files.forEach((file) => {
        // Check if the file extension is ".json"
        if (path.extname(file) === ".json") {
            const fileRootName = path.parse(file).name;

            const fileData = fs.readFileSync( path.join( flowspecsFolder, file ), "utf-8" );
            
            environments.map( ( environment ) => {
                const result = fileData.replace( pattern, ( match, key ) => globalsDict[ key ]?.[ environment ] );
                const outputFile = path.join( globalsReplacedFolder, environment, `${fileRootName}-replaced-globals.json` );
                fs.writeFileSync( outputFile, result );
                console.log(`${file}: successfully replaced globals [${environment}]`);
            } )
        }
    } );
    return true;
}

module.exports = replaceGlobals;