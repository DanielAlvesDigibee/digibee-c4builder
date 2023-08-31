const fs = require("fs");
const { type } = require("os");
const path = require("path");
/*const jsonpath = require("jsonpath");
const { parse: json2csv } = require("json2csv");*/

let connections = {};
const allSystems = new Set();

function replaceDoubleQuotes(value) {
    return value.replaceAll("\"","'")
}

function generateLinePUMLSystem( connector, connections, originPipelineName, lastConnector ) {
    
    let hasLayout = false
    let line = "\n";

    if (connector.isDb === true) {
        line += "ContainerDb";
    } else {
        if (connector.isExternal === true) {
            line += "System_Ext";
        } else {
            line += "System";
            hasLayout = true
        }
    }

    // if has no id, it is only a "to"
    if (!connector.isDb && !connector.isExternal) {
        line += `( ${connector.id}, "Pipeline", "${replaceDoubleQuotes(connector.name)}")`;
    } else {
        line += `( ${connector.id}, "${connector.name}", "${replaceDoubleQuotes(originPipelineName)}")`;
    }

    if ( hasLayout && lastConnector !== null) {
        line += "\nLay_U("
        lastConnector = connector
    }
    
    return line;
}

function generateLinePUMLRelation(connector, connections, originPipelineName, targetConnection) {
    let line = "\n";

    const target = connector.to[targetConnection];

    if (connections[targetConnection].to[originPipelineName] !== undefined) {
        line += "Bi";
    }

    if (connections[targetConnection].isDb === true || connections[targetConnection].isExternal === true || connections[targetConnection].systemId === connector.systemId) {
        line += "Rel_D";
    } else {
        line += "Rel";
    }
    
    line += `(${connector.id}, ${connections[ targetConnection ].id}, "${target.type}`;
    
    if ( target.extra !== undefined && target.extra !== "" ) {
        line += `**\\n**${replaceDoubleQuotes(target.extra)}`;
    }
    line += `**\\n**'${replaceDoubleQuotes(target.connectorName)}'")`;
    
    return line;
}

async function generatePUML() {
    try {
        const extractedDataFolder = path.join(__dirname, "data/extractions/");

        //Read all extractions
        fs.readdirSync(extractedDataFolder).forEach((file) => {
            console.log(`Reading extracted data from "${file}"...`);
            // Check if the file extension is ".json"
            if (path.extname(file) === ".json") {
                const rawPipelineData = fs.readFileSync( path.join( extractedDataFolder, file ), "utf8" ).split( "\n" );
                const pipelinesConnections = JSON.parse(rawPipelineData)
                const outputFileName = path.join(__dirname, "c4_src/container.puml");

                writeFileHeader(outputFileName);

                for (let i = 0; i < pipelinesConnections.length; i++) {
                    evalConnections(pipelinesConnections[i]);
                }

                let systems = [];
                let relations = [];
                let lastConnector = null;



                for (let originPipelineName in connections) {
                    const connector = connections[originPipelineName];

                    //if (Object.keys(connector.from).length > 0 || Object.keys(connector.to).length > 0) {
                    if (systems[connector.systemId] === undefined) {
                        systems[ connector.systemId ] = "";
                    }

                    systems[ connector.systemId ] += generateLinePUMLSystem( connector, connections, originPipelineName, lastConnector );
                    

                    if (Object.keys(connector.to).length > 0) {
                        for (let targetConnection in connector.to) {
                            if (relations[connector.systemId] === undefined) {
                                relations[connector.systemId] = "";
                            }

                            relations[connector.systemId] += generateLinePUMLRelation(connector, connections, originPipelineName, targetConnection);
                        }
                    }
                    //}
                }

                fileAppend(outputFileName, systems[0], "external systems");
                for ( let system of allSystems ) {
                    system = JSON.parse(system)
                    const startBoundary = `\n\nSystem_Boundary(${system.id}, "Project: ${system.name}") {`;
                    const endBoundary = `\n}\n`;
                    fileAppend(outputFileName, startBoundary, "startBoundary");
                    if (systems[system.id] !== undefined) {
                        fileAppend(outputFileName, systems[system.id], `systems[systemId] = systems[${system.id}]`);
                    }

                    fileAppend(outputFileName, endBoundary, "endBoundary");
                }

                for (let system of allSystems) {
                    system = JSON.parse(system);

                    if ( relations[ system.id ] !== undefined ) {
                        fileAppend(outputFileName, relations[system.id], `relations[systemId] = relations[${system.id}]`);
                    }
                }
                //fileAppend(outputFileName, relations[0], "relations[0]");

                writeFileFooter(outputFileName);

                console.log(`PUML file created successfully. (${outputFileName})`);
                return true;
            }
        });
        return true;
    } catch (e) {
        console.error(`Failed to write PUML.\nMessage: ${e.message.toString()}\nStack: ${e.stack.toString()}`);
        return false;
    }
}

function evalConnections(pipelineJson) {
    // const csvFields = ["file", "connectorId", "connector", "name", "breadCrumb", "data", "extra"];

    const from = pipelineJson.file; // name of origin pipeline
    const id = pipelineJson.pipelineId.replace( /[^\d|A-z]/g, "" ); // id of connector from origin pipeline
    const systemId = pipelineJson.projectId.replace(/[^\d|A-z]/g, "");
    const systemName = pipelineJson.projectName;

    allSystems.add( JSON.stringify({ id: systemId , name: systemName }) ); // add system to set

    // Create system (pipeline)
    if (connections[from] === undefined) {
        // from not found
        connections[from] = {
            name: from,
            id,
            to: {},
            from: {},
            systemId,
            systemName,
            isExternal: false,
            isDb: false,
        };
    } else {
        // already created from another pipeline connection
        connections[ from ].name = from
        connections[ from ].id = id;
        connections[ from ].systemId = systemId;
        connections[ from ].systemName = systemName;
        connections[ from ].isExternal = false;
        connections[ from ].isDb = false;
    }


    for ( let i = 0; i < pipelineJson.connections.length; i++ ) {
        const dbsConnectors = ["object-store-connector", "db-connector-v2", "stream-db-connector-v3", "mongodb-connector", "cassandra-connector"];
        const externalConnectors = ["rest-connector-v2", "db-connector-v2", "stream-db-connector-v3", "mongodb-connector", "cassandra-connector"];

        const connection = pipelineJson.connections[i];

        const type = connection.connector; // type of connection
        const name = connection.name; // step name of connection
        const breadcrumb = connection.breadcrumb; // breadcrumb of connector in pipeline
        const to = connection.data.replaceAll(/\$\.| /g, ""); // information to where connector is targeting (URL, pipeline name...)
        const extra = connection.extra; // extra info about connection
        //const connectionId = connection.connectorId.replace(/[^\d|A-z]/g, "");

        const toIsExternal = externalConnectors.includes(type);
        const toIsDb = dbsConnectors.includes(type);

        if (connections[to] === undefined) {
            // to not found
            connections[to] = {
                from: {},
                to: {},
                name: connection.connector,
                id: hashString(to),
                isExternal: toIsExternal,
                isDb: toIsDb,
            };
            if (toIsExternal === false) {
                connections[to].systemId = systemId;
                connections[to].systemName = systemName;
            } else {
                connections[to].systemId = 0;
                connections[to].systemName = "external";
            }

            connections[to].from[connections[from].id] = true;
        } else {
            if (connections[to].isExternal === false) {
                connections[to].isExternal = toIsExternal;
            }

            // mark from connection
            connections[to].from[connections[from].id] = true;
        }

        if (connections[from].to[to] === undefined) {
            // connection from -> to not found
            connections[from].to[to] = {};
            connections[from].to[to].type = type;
            connections[from].to[to].extra = extra;
            connections[from].to[to].breadcrumb = breadcrumb;
            connections[from].to[to].connectorName = name;
        }
    }
}

function writeFileHeader(fileName) {
    const headers =
        "@startuml\n\
!include https://raw.githubusercontent.com/adrianvlupu/C4-PlantUML/latest/C4_Container.puml\n\n\
LAYOUT_TOP_DOWN()\n\
LAYOUT_WITH_LEGEND()\n";

    try {
        fs.writeFileSync(fileName, headers);
        console.log("PUML header write success.");
    } catch (e) {
        console.log(errMsg);
    }
}

function writeFileFooter(fileName) {
    const footer = "\n\n@enduml";

    fileAppend(fileName, footer, "Failed to write footer to file.");
}

function fileAppend(fileName, data, errMsg = "Failed to append file") {
    try {
        if (typeof data === "string") {
            fs.appendFileSync(fileName, data);
        }
    } catch (e) {
        console.error(e);
        console.log(errMsg);
    }
}

function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        var char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16).replace(/[^\d|A-z]/g, "");
}

module.exports = generatePUML;
generatePUML();