const fs = require("fs");
const path = require("path");
const jsonpath = require("jsonpath");
const { parse: json2csv } = require("json2csv");

function extractConnectorInfo(connector, infoJsonPath, condition) {
    if (condition) {
        let result = jsonpath.query(connector, infoJsonPath?.startsWith("$") ? infoJsonPath : "$." + infoJsonPath);
        if (Array.isArray(result) && result.length == 1) {
            result = result[0];
        }
        return result;
    } else {
        return null;
    }
}

function extractPipelineProject( allProjects, pipelineId ) {

    let results = allProjects.data.project.filter( ( x ) => x.pipes.includes( pipelineId ) );

    return { id: results[0].id ?? null, name: results[0].name ?? null};
}

function checkStringForSubstrings(mainString, substrings) {
    mainString = mainString.toLowerCase();
    for (let i = 0; i < substrings.length; i++) {
        if (!mainString.includes(substrings[i].toLowerCase())) {
            return false;
        }
    }
    return true;
}

function normalizeFileName(fileName) {
    return fileName.replace("-replaced-globals", "");
}

async function extractPipelineData() {
    try {
        const flowspecsFolder = path.join(__dirname, "data/flowspecs/globals-replaced/prod");
        const gqlFlowspecsFolder = path.join(__dirname, "data/flowspecs/gql");
        
        const allProjectsInfoFile = path.join(__dirname, "data/projects.json");
        //const filePath = path.join( __dirname, "flowspecs/globals-replaced/prod", "auth-api.json" );


        const allProjectsInfo = fs.readFileSync( allProjectsInfoFile, "utf8" );
        const jsonAllProjectsInfo = JSON.parse(allProjectsInfo);
        

        //Read all flowspecs
        let pipelines = [];
        fs.readdirSync(flowspecsFolder).forEach(async (file) => {
            console.log(`Extracting data from "${file}"...`);
            // Check if the file extension is ".json"
            if (path.extname(file) === ".json") {
                try {
                    const rawFlowspec = fs.readFileSync(path.join(flowspecsFolder, file), "utf8");
                    const rawFlowspecDetails = fs.readFileSync(path.join(gqlFlowspecsFolder, normalizeFileName(file)), "utf8");

                    const fileRootName = path.parse(file).name;
                    const jsonFlowspecDetails = JSON.parse( rawFlowspecDetails );
                    
                    const project = extractPipelineProject( jsonAllProjectsInfo, jsonFlowspecDetails.data.pipeline.id )
                    

                    const jsonFlowspec = JSON.parse(rawFlowspec);
                    let currScope = jsonFlowspec["start"];
                    let currNode = null;

                    let finished = false;
                    let connectorCount = 0;
                    let connections = [];

                    while (!finished && connectorCount < 100000) {
                        if (currScope.length > 0) {
                            currNode = currScope.shift();
                            currNode.breadCrumb = currNode.breadCrumb ?? "$";

                            let extractions = [
                                extractConnectorInfo(currNode, "params['pipelineName','operation']", currNode.name == "pipeline-executor-connector"),
                                extractConnectorInfo(currNode, "params['eventName']", currNode.name == "event-publisher-connector"),

                                extractConnectorInfo(currNode, "params['url','operation']", currNode.name == "rest-connector-v2"),

                                extractConnectorInfo(currNode, "params['objectStore','operation']", currNode.name == "object-store-connector"),
                                extractConnectorInfo(currNode, "params['url']", currNode.name == "db-connector-v2"),
                                extractConnectorInfo(currNode, "params['url']", currNode.name == "stream-db-connector-v3"),
                                extractConnectorInfo(currNode, "params['url','operation','databaseName','collectionName']", currNode.name == "mongodb-connector"),
                                extractConnectorInfo(currNode, "params['url','operation']", currNode.name == "cassandra-connector"),
                            ];

                            let extraction = null;
                            for (let i = 0; i < extractions.length; i++) {
                                if (extractions[i] !== null) {
                                    extraction = [];
                                    extractions[i] = Array.isArray(extractions[i]) ? extractions[i] : [extractions[i]];
                                    extraction.push(extractions[i][0] ?? "");
                                    extraction.push(extractions[i][1] ?? "");
                                    break;
                                }
                            }

                            if (extraction !== null) {
                                connections.push({ from: normalizeFileName(fileRootName), breadCrumb: currNode.breadCrumb, data: extraction[0], extra: extraction[1], connectorId: currNode.id, connector: currNode.name, name: currNode.stepName });
                            }

                            if (currNode.params?.onException) {
                                let tempScope = jsonFlowspec[currNode.params.onException].map((tempNode) => {
                                    return { ...tempNode, breadCrumb: currNode.breadCrumb + `['${currNode.stepName} (onException)']` };
                                });
                                currScope.unshift(...tempScope);
                            }

                            if (currNode.params?.onProcess) {
                                let tempScope = jsonFlowspec[currNode.params.onProcess].map((tempNode) => {
                                    return { ...tempNode, breadCrumb: currNode.breadCrumb + `['${currNode.stepName} (onProcess)']` };
                                });
                                currScope.unshift(...tempScope);
                            }

                            if (currNode.otherwise) {
                                currScope.unshift(...jsonFlowspec[currNode.otherwise]);
                            }

                            if (currNode.when) {
                                for (let choicePath of currNode.when) {
                                    currScope.unshift(...jsonFlowspec[choicePath.target]);
                                }
                            }
                            connectorCount++;
                        } else {
                            finished = true;
                        }
                    }

                    pipelines.push({ file: normalizeFileName(fileRootName), trigger: jsonFlowspecDetails.data.pipeline.triggerSpec.type, projectId: project.id, projectName: project.name, connections, pipelineId: jsonFlowspecDetails.data.pipeline.id });
                } catch (e) {
                    console.error(`Flowspec error at file ${file}.`);
                    console.error(e);
                    return false;
                }
            } else {
                return false;
            }
        } );
        


        let fileName = writeJsonFile(pipelines, "pipelinesConnections.json");
        // writeJsonFile( pipelines, "projects.json");
        //let fileName = writeCSVFile(["file", "connectorId", "connector", "name", "breadCrumb", "data", "extra"], connections, "extractions.csv");
        //writeCSVFile(["file", "trigger", "projectId", "projectName"], pipelines, "projects.csv");
        console.log(`Connections data successfully extracted from pipelines. (${fileName})`);
        return true;
    } catch (e) {
        console.error(`Failed to navigate pipeline.\nMessage: ${e.message.toString()}\nStack: ${e.stack.toString()}`);
        return false;
    }
}

function writeCSVFile(headers, data, fileName) {
    const csv = json2csv(data, { fields: headers });

    const filePath = path.join(__dirname, "data/extractions");
    if (!fs.existsSync(filePath)) {
        fs.mkdirSync(filePath, { recursive: true });
    }

    let completeFileName = path.join(filePath, fileName);
    fs.writeFileSync(completeFileName, csv);
    return completeFileName;
}

function writeJsonFile(data, fileName) {
    const filePath = path.join(__dirname, "data/extractions");
    if (!fs.existsSync(filePath)) {
        fs.mkdirSync(filePath, { recursive: true });
    }

    let completeFileName = path.join(filePath, fileName);
    fs.writeFileSync(completeFileName, JSON.stringify(data));
    return completeFileName;
}

module.exports = extractPipelineData;