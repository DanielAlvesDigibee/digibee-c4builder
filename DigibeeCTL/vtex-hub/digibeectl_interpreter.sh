#!/bin/bash

############################## FUNCTIONS ##############################
# Function to right pad strings with equal character (for base64 strings)
function right_pad_with_equal {
    local input_string=$1
    local character="="
    local input_length=${#input_string}
    local remainder=$((input_length % 4))
    local padding=$((4 - remainder))

    if [ $remainder -eq 0 ]; then
        # No padding required, return the original string
        echo "$input_string"
    else
        # Pad with the specified character and return the result
        printf "%s%s" "$input_string" "$(printf '%*s' "$padding" | tr ' ' "$character")"
    fi
}

function download_flowspec {

  local pipelineId=$1
  local flowspecFile=$2
  local pipelineName=$3
  local retries=${4:-0}

  echo "Downloading flowspec from pipeline $pipelineName ($pipelineId)... Retries: $retries"
  digibeectl get pipeline --pipeline-id $pipelineId --flowspec > $flowspecFile

  local line=$(head -n 1 "${flowspecFile}")

  if [[ "$line" == "This version is deprecated."* && "$retries" -le 10 ]]; then
    echo "ERROR: Downloading flowspec from pipeline $pipelineName ($pipelineId)."
    (( ++retries ))
    sleep 5
    download_flowspec "${pipelineId}" "${flowspecFile}" "${pipelineName}" "${retries}"
  else
    if [[ "$retries" -gt 10 ]]; then
      echo "FAILED: Downloading flowspec from pipeline $pipelineName ($pipelineId)."
    else
      echo "SUCCESS: Downloading flowspec from pipeline $pipelineName ($pipelineId). Total retries: $retries"
    fi
  fi
}

# Validate GraphQL token on .env file
function check_graphql_token {
  echo -n  "Checking for GraphQL token... "
  # Check if the "GRAPHQL_TOKEN" variable exists in the .env file
  if [ -z "$GRAPHQL_TOKEN" ]; then
      echo "Error: 'GRAPHQL_TOKEN' variable not found in .env file."
      exit 1
  fi

  # Split the "GRAPHQL_TOKEN" variable on the character "."
  IFS='.' read -ra token_parts <<< "$GRAPHQL_TOKEN"

  # Check if the token has at least two elements
  if [ ${#token_parts[@]} -lt 2 ]; then
      echo "Error: Invalid token format. It must contain at least two parts separated by '.'"
      exit 1
  fi

  # Decode the second element (index 1) base64
  padded_string=$(right_pad_with_equal "${token_parts[1]}")
  decoded_string=$(echo "$padded_string"  | base64 -d)
  parsed_json=$(echo "$decoded_string" | jq .)

  exp_value=$(echo "$parsed_json" | jq -r '.exp')
  current_timestamp=$(date +%s)

  if [ "$exp_value" -lt "$current_timestamp" ]; then
      echo "Error: GRAPHQL_TOKEN in .env file is expired. Please refresh."
  fi
  echo "DONE"
}

# Get globals using graphql
function get_globals() {
  local API_KEY="$1"
  local TOKEN="$2"
  local REALM="$3"
  local OUTPUT_FILE="$4"

  # Query Digibee's graphql to get globals, format JSON and save to file
  curl -s 'https://core.godigibee.io/graphql' \
    -H 'apikey: '${API_KEY} \
    -H 'authorization: Bearer '${TOKEN} \
    -H 'content-type: application/json' \
    --data-raw $'{"operationName":"globals","variables":{"realm":"'${REALM}'","search":""},"query":"query globals($realm: String\u0021, $search: String) { globals(realm: $realm, search: $search) { id category description field valuesByEnv realm { id name description companyName } } } "}' \
    --compressed | jq '.' > ${OUTPUT_FILE}
} 
 
# Get projectsusing graphql
function get_projects() {
  local API_KEY="$1"
  local TOKEN="$2"
  local REALM="$3"
  local OUTPUT_FILE="$4"


  # Query Digibee's graphql to get all projects, format JSON and save to file
  allProjects=$(curl  -s 'https://core.godigibee.io/graphql' \
    -H 'apikey: '${API_KEY} \
    -H 'authorization: Bearer '${TOKEN} \
    -H 'content-type: application/json' \
    --data-raw $'{"operationName":"project","variables":{"realm":"'${REALM}'"},"query":"query project($realm: String\u0021) { project(realm: $realm) { id name description amountOfPipelines allowAllUsers allowedGroups allowedUsers } } "}' \
    --compressed | jq '.')
  
  i=0
  while read projectId; do
      pipelinesInProject=$(curl -s 'https://core.godigibee.io/graphql' \
        -H 'apikey: '${API_KEY} \
        -H 'authorization: Bearer '${TOKEN} \
        -H 'content-type: application/json' \
        --data-raw $'{"operationName":"searchPipelines","variables":{"realm":"'${REALM}'","search":{"name":"","projectId":'${projectId}'}},"query":"query searchPipelines($realm: String\u0021, $search: JSON) { searchPipelines(realm: $realm, search: $search) { content last number first numberOfElements size } } "}' \
        --compressed | jq '.data.searchPipelines.content[]._id')
  
      pipelinesInProject=$(printf ",%s" ${pipelinesInProject[@]})
      pipelinesInProject="${pipelinesInProject:1}"
  
      allProjects=$(jq '.data.project['${i}'].pipes += ['${pipelinesInProject}']' <<<"$allProjects")
      ((i++))
  done < <(jq '.data.project[].id' <<< "$allProjects")

  echo $allProjects > ${OUTPUT_FILE}
}

# Get pipeline info using graphql
function get_pipeline_info() {
  local API_KEY="$1"
  local TOKEN="$2"
  local REALM="$3"
  local OUTPUT_FILE="$4"
  local PIPELINE_ID="$5"

  # Query Digibee's graphql to get pipeline info, format JSON and save to file
  curl -s 'https://core.godigibee.io/graphql' \
  -H 'apikey: '${API_KEY} \
  -H 'authorization: Bearer '${TOKEN} \
  -H 'content-type: application/json' \
  --data-raw $'{"operationName":"data","variables":{"id":"'${PIPELINE_ID}'","realm":"'${REALM}'"},"query":"query data($realm: String\u0021, $id: ID\u0021) { pipeline(realm: $realm, id: $id) { id name description draft versionMajor versionMinor inSpec outSpec parameterizedReplica triggerSpec hasAlert alert thumbnailName canvasVersion componentsCount connectedOnFlowComponentsCount usedComponents createdAt canvas { nodes { id type data } edges { id source target data { type conditionType conditionRule condition label description executionId } } } } sensitiveFields(realm: $realm, id: $id) { logSensitiveFields } } "}' \
  --compressed | jq '.' > ${OUTPUT_FILE}
}

############################## SNOITCNUF ##############################

#clear console
clear && printf '\e[3J'

# Load environment variables from .env file
if [ -f ".env" ]; then
    #load keys
    source .env
else
    echo "Error: .env file not found."
    exit 1
fi

check_graphql_token

SET_CONFIG=false
DOWNLOAD_DEPLOYMENTS=false
DOWNLOAD_FLOWSPEC=false
DOWNLOAD_GLOBALS=false

while :; do
    case $1 in
        -a|--all) 
          SET_CONFIG=true
          DOWNLOAD_DEPLOYMENTS=true
          DOWNLOAD_FLOWSPEC=true
          DOWNLOAD_GLOBALS=true 
          DOWNLOAD_PROJECTS=true 
        ;;
        -c|--config)
          SET_CONFIG=true
        ;;
        -d|--deployments)
          DOWNLOAD_DEPLOYMENTS=true
        ;;
        -f|--flowspecs)
          DOWNLOAD_FLOWSPEC=true
        ;;
        -g|--globals)
          DOWNLOAD_GLOBALS=true
        ;;
        -p|--projects)
          DOWNLOAD_PROJECTS=true
        ;;
        *) break
    esac
    shift
done

#add digibeectl to path
function add_to_path() {
    [[ -d "$1" ]] && [[ ":$PATH:" != *":$1:"* ]] && PATH="$PATH:$1"
}
add_to_path "/usr/local/bin/digibeectl"

# Set config
if [[ $SET_CONFIG = true ]]; then
  echo -n "Setting config file... "
  # Check for token.json file
  if [ -f "token.json" ]; then
      digibeectl set config -f $(pwd)/token.json -s ${SECRET_KEY} -a ${AUTH_KEY}
      echo "DONE"
  else
      echo "Error: '$(pwd)/token.json' file not found."
  fi
fi

# Get realm name
realmName=$(digibeectl get config | egrep -Eo "realm: (\w+-?)+" | egrep -o "(\w+-?)+$")
rootFolder="$HOME/Documents/Digibee/DigibeeCTL/$realmName"
datafolder="$rootFolder/data"
echo ""
echo "Starting process for realm: '$realmName'"
echo ""

# Write .c4builder file
echo -n '{"projectName": "'$realmName'","homepageName": "Overview","rootFolder": "c4_src","distFolder": "c4_out","generateMD": true,"generatePDF": true,"generateCompleteMD": true,"generateCompletePDF": true,"generateWEB": true,"includeNavigation": true,"includeTableOfContents": true,"webTheme": "//unpkg.com/docsify/lib/themes/vue.css","supportSearch": true,"repoUrl": "","docsifyTemplate": "","webPort": "3000","pdfCss": "/usr/local/lib/node_modules/c4builder/pdf.css","plantumlVersion": "latest","includeBreadcrumbs": true,"includeLinkToDiagram": false,"diagramsOnTop": true,"embedDiagram": true,"excludeOtherFiles": false,"generateLocalImages": true,"plantumlServerUrl": "https://www.plantuml.com/plantuml","diagramFormat": "svg","charset": "UTF-8","hasRun": true,"checksums": []}' > .c4builder
mkdir -p "$rootFolder/c4_src"
mkdir -p "$rootFolder/c4_out"

# Check if "data" folder exists
if [ -d "data" ]; then
    echo "A folder named 'data' already exists."
    echo "Do you want to delete the 'data' folder and its contents? (y/n)"
    read response
    if [[ $response == "y" || $response == "Y" ]]; then
        # Delete the 'data' folder and its contents
        rm -rf data
        echo "The folder named 'data' and its contents were deleted."
    fi
fi

#make folders if don't exist
echo -n "Creating folders structure... "
mkdir -p $rootFolder
mkdir -p $datafolder
mkdir -p "$datafolder/flowspecs"
mkdir -p "$datafolder/flowspecs/gql"
echo "DONE"
echo "Root folder: '$rootFolder'"

#get all globals
if [[ $DOWNLOAD_GLOBALS = true ]]; then
  globalsFile="$datafolder/globals.json"
  echo -n "Downloading globals... "
  get_globals "${GRAPHQL_API_KEY}" "${GRAPHQL_TOKEN}" "${realmName}" "${globalsFile}"
  echo "DONE"
fi

#get all projects
if [[ $DOWNLOAD_PROJECTS = true ]]; then
  projectsFile="$datafolder/projects.json"
  echo -n "Downloading projects... "
  get_projects "${GRAPHQL_API_KEY}" "${GRAPHQL_TOKEN}" "${realmName}" "${projectsFile}"
  echo "DONE"
fi

#get all pipelines info
pipelinesFile="$datafolder/pipelines-list.csv"
echo -n "Getting pipelines infos... "
digibeectl get pipelines $env | tr -s ' ' ',' > $pipelinesFile

line=$(head -n 1 "${pipelinesFile}")
if [[ "$line" = "This version is deprecated. Please, upgrade your version and try again." ]]; then
  echo "Error Getting pipelines infos. "
fi

echo "DONE"

#get deployments info
if [[ $DOWNLOAD_DEPLOYMENTS = true ]]; then
  environments=("test" "prod")
  for env in ${environments[@]}; do
  echo -n "Getting deployments in '$env' environment... "
  deploymentsFile="$datafolder/deployments-$env.csv" 
  digibeectl get deployments -e $env | tr -s ' ' ',' > $deploymentsFile
  echo "DONE"
  done
fi

#read pipelinesFile
[ ! -f $pipelinesFile ] && { echo "$pipelinesFile file not found"; exit 99; }
exec < $pipelinesFile || exit 1
read header # ignore header

#get all pipelines flowspecs
if [[ $DOWNLOAD_FLOWSPEC = true ]]; then
  while IFS=',' read name	id version archived; do
    flowspecFile=$datafolder"/flowspecs/$name.json"
    flowspecFileGQL=$datafolder"/flowspecs/gql/$name.json"
    download_flowspec "${id}" "${flowspecFile}" "${name}" &
    get_pipeline_info "${GRAPHQL_API_KEY}" "${GRAPHQL_TOKEN}" "${realmName}" "${flowspecFileGQL}" "${id}" &
  done
fi

wait

echo ""
echo "All done"
exit 0