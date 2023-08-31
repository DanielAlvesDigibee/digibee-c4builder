const { spawn, exec } = require("node:child_process");
const readline = require("readline");
const replaceGlobals = require("./replace-globals");
const extractPipelineData = require("./pipeline-navigator");
const generatePUML = require("./generate-puml");

function openLocalHost() {
    const url = "http://localhost:3000";

    let command;

    switch (process.platform) {
        case "darwin":
            // macOS
            command = `open "${url}"`;
            break;
        case "win32":
            // Windows
            command = `start "" "${url}"`;
            break;
        default:
            // Linux and other platforms
            command = `xdg-open "${url}"`;
            break;
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error opening URL: ${error.message}`);
            return;
        }
        console.log("URL opened successfully.");
    });
}

async function testProcess() {
    let success = false;
    success = await replaceGlobals();

    console.log(success);
    if (success) {
        process.stdout.write("\nGlobals replaced.\n\n");
    } else {
        process.stdout.write("Error occurred while replacing globals.\n");
        return;
    }

    process.stdout.write("\nWill extract data from pipelines\n\n");
    success = await extractPipelineData();

    if (success) {
        process.stdout.write("\nData extracted.\n\n");
    } else {
        process.stdout.write("Error occurred while extracting data.\n");
        return;
    }

    process.stdout.write("\nWill generate PUML\n\n");
    success = await generatePUML();

    /*if (success) {
        process.stdout.write("\nPUML generated.\n\n");
        const c4builder = exec("c4builder site");
        
        // Print bash script echo data
        c4builder.stdout.on("data", (data) => {
            process.stdout.write(data.toString());
        });
        
        // Print eventual errors
        c4builder.stderr.on("error", (err) => {
            process.stdout.write(err + "\n");
        });

        c4builder.stdout.on("close", async (code) => {
            console.log("Site server built on localhost:3000.");
            openLocalHost();
        });
    } else {
        process.stdout.write("Error occurred while generating PUML.\n");
        return;
    }*/
    
    /*await replaceGlobals();
    await extractPipelineData();
    await generatePUML();
    exec("c4builder site", (error, stdout, stderr) => {
        if (error) {
            console.error(`Error building site server: ${error.message}`);
            return;
        }
        console.log("Site server built on localhost:3000.");
        openLocalHost();
    });*/
}
testProcess();
