// Global Variables
var global = {
    balances: [],
    address: '',
    pointCount: 200,
    blockHashes: [],
    endpoint: '',
    chainDecimals: '',
    chainToken: 'Units',
    layout: {},
};

// Update window URL to contain querystring, making it easy to share
function updateUrl(startBlock, endBlock) {
    var url = [location.protocol, '//', location.host, location.pathname].join(
        ''
    );
    url +=
        '?endpoint=' + global.endpoint +
        '&address=' + global.address +
        '&start=' + startBlock +
        '&end=' + endBlock;
    window.history.replaceState({ path: url }, '', url);
}

// Convert a big number balance to expected float with correct units.
function toUnit(balance, decimals) {
    base = new BN(10).pow(new BN(decimals));
    dm = new BN(balance).divmod(base);
    div_string = dm.div.toString();
    mod_string = dm.mod.toString().padStart(decimals, '0');
    final_string = div_string + "." + mod_string;
    final = parseFloat(final_string);
    return final
}

// Given an address and a range of blocks, query the Substrate blockchain for the balance across the range
async function getBalanceInRange(address, startBlock, endBlock) {
    //Update UX with Start and End Block
    document.getElementById('startBlock').value = startBlock;
    document.getElementById('endBlock').value = endBlock;

    //Update window URL
    updateUrl(startBlock, endBlock);

    // Calculate the step size given the range of blocks and the number of points we want
    var step = Math.floor((endBlock - startBlock) / global.pointCount);
    // Make sure step is at least 1
    if (step < 1) {
        step = 1;
    }

    // Tell the user the data is loading...
    document.getElementById('output').innerHTML = 'Loading';

    try {
        var promises = [];

        // Get all block hashes
        for (let i = startBlock; i < endBlock; i = i + step) {
            if (!global.blockHashes.find(x => x.block == i)) {
                let blockHashPromise = substrate.rpc.chain.getBlockHash(i);
                promises.push(i, blockHashPromise);
            }
        }

        var results = await Promise.all(promises);

        for (let i = 0; i < results.length; i = i + 2) {
            global.blockHashes.push({
                block: results[i],
                hash: results[i + 1]
            });
        }

        var promises = [];

        // Loop over the blocks, using the step value
        for (let i = startBlock; i < endBlock; i = i + step) {
            // If we already have data about that block, skip it
            if (!global.balances.find(x => x.block == i)) {
                // Get the block hash
                let blockHash = global.blockHashes.find(x => x.block == i).hash;
                // Create a promise to query the balance for that block
                let accountDataPromise = substrate.query.system.account.at(blockHash, address);
                // Create a promise to get the timestamp for that block
                let timePromise = substrate.query.timestamp.now.at(blockHash);
                // Push data to a linear array of promises to run in parellel.
                promises.push(i, accountDataPromise, timePromise);
            }
        }

        // Call all promises in parallel for speed.
        var results = await Promise.all(promises);

        // Restructure the data into an array of objects
        var balances = [];
        for (let i = 0; i < results.length; i = i + 3) {
            let block = results[i];
            let accountData = results[i + 1];

            let free = toUnit(accountData.data.free, global.chainDecimals);
            let reserved = toUnit(accountData.data.reserved, global.chainDecimals);
            let total = free + reserved;

            balances.push({
                block: block,
                free: free,
                reserved: reserved,
                total: total,
                time: new Date(results[i + 2].toNumber())
            });
        }

        //Remove loading message
        document.getElementById('output').innerHTML = '';

        return balances;
    } catch (error) {
        document.getElementById('output').innerHTML = error;
    }
}

// Unpack a multi-dimensional object
function unpack(rows, index) {
    return rows.map(function (row) {
        return row[index];
    });
}

// Create the plotly.js traces with the balance data.
function createTraces(balances) {
    let blocks = unpack(balances, 'block');
    let time = unpack(balances, 'time');
    // Create the trace we are going to plot
    var trace1 = {
        type: 'scatter',
        mode: 'lines',
        x: blocks,
        y: unpack(balances, 'total'),
        hoverinfo: 'name+y+x+text',
        text: time,
        name: 'Total'
    };

    var trace2 = {
        type: 'scatter',
        mode: 'lines',
        x: blocks,
        y: unpack(balances, 'free'),
        hoverinfo: 'name+y+x+text',
        text: time,
        name: 'Free',
        visible: 'legendonly'
    };

    var trace3 = {
        type: 'scatter',
        mode: 'lines',
        x: blocks,
        y: unpack(balances, 'reserved'),
        hoverinfo: 'name+y+x+text',
        text: time,
        name: 'Reserved',
        visible: 'legendonly'
    };

    return [trace1, trace2, trace3]
}

// Create the plotly.js graph with the trace data.
function createGraph(data) {
    // Settings for the graph
    global.layout = {
        title: 'Balance over Time',
        showlegend: true,
        uirevision: true,
        xaxis: {
            autorange: true,
            rangeslider: {},
            type: 'linear',
            title: 'Block'
        },
        yaxis: {
            autorange: true,
            type: 'linear',
            title: global.chainToken || 'Balance'
        }
    };
    Plotly.newPlot('graph', data, global.layout);
}

// Sort function for sort by block value
function sortBlock(a, b) {
    return a.block - b.block;
}

// When the graph is zoomed in, get more data points for that range
$('#graph').on('plotly_relayout', async function (eventdata) {
    // Get the new block range from the eventdata from the resize
    var startBlock = Math.floor(eventdata.target.layout.xaxis.range[0]);
    var endBlock = Math.ceil(eventdata.target.layout.xaxis.range[1]);

    // Get new balance data, and concatenate it to the existing data
    global.balances = global.balances.concat(
        await getBalanceInRange(global.address, startBlock, endBlock)
    );

    // Sort the data by block number for Plotly.js, since it is a scatter plot
    global.balances.sort(sortBlock);

    // Create a new trace with new data
    var traces = createTraces(global.balances)

    // Update the traces.
    Plotly.react('graph', traces, global.layout);
});

//Reset the page
function reset() {
    document.getElementById('output').innerHTML = '';
    Plotly.purge('graph');
    global.balances = [];
    global.address = '';
    global.blockHashes = [];
}

// Connect to Substrate endpoint
async function connect() {
    let endpoint = document.getElementById('endpoint').value;
    if (!window.substrate || global.endpoint != endpoint) {
        const provider = new api.WsProvider(endpoint);
        document.getElementById('output').innerHTML = 'Connecting to Endpoint...';
        window.substrate = await api.ApiPromise.create({ provider });
        global.endpoint = endpoint;
        global.chainDecimals = substrate.registry.chainDecimals[0];
        global.chainToken = substrate.registry.chainTokens[0];
        document.getElementById('output').innerHTML = 'Connected';
    }
}

// Main function
async function graphBalance() {
    try {
        reset();
        await connect();

        // Get address from input
        global.address = document.getElementById('address').value;

        // Find the intial range, from first block to current block
        var startBlock, endBlock;

        if (document.getElementById('endBlock').value) {
            endBlock = parseInt(document.getElementById('endBlock').value);
        } else {
            endBlock = parseInt(await substrate.derive.chain.bestNumber());
        }

        if (document.getElementById('startBlock').value) {
            startBlock = parseInt(document.getElementById('startBlock').value);
        } else {
            // 10 blocks per minute, 1440 min per day, 7 days per week
            let HISTORICAL = 10 * 1440 * 7;
            startBlock = endBlock < HISTORICAL ? 0 : endBlock - HISTORICAL;
        }

        // Check that the address actually has transactions to show
        if (startBlock >= 0 && startBlock < endBlock) {
            // Get the balances from that range, store in global variable
            global.balances = await getBalanceInRange(
                global.address,
                startBlock,
                endBlock
            );
            if (global.balances) {
                // Create the graph
                let traces = createTraces(global.balances);
                createGraph(traces);
            } else {
                document.getElementById('output').innerHTML =
                    'No transactions found for that address.';
            }
        } else {
            document.getElementById('output').innerHTML =
                'No transactions found for that address.';
        }
    } catch (error) {
        document.getElementById('output').innerHTML = error;
    }
}

// Detect Querystrings
function parseQueryStrings() {
    var queryStrings = {};
    //Parse URL
    var url = window.location.search.substring(1);
    if (url) {
        //split querystrings
        var pairs = url.split('&');
        for (pair in pairs) {
            pairArray = pairs[pair].split('=');
            queryStrings[pairArray[0]] = pairArray[1];
        }
    }

    return queryStrings;
}

// On load, check if querystrings are present
window.onload = async function () {
    await connect();
    // Check for querystrings
    var queryStrings = parseQueryStrings();
    // Set endpoint
    if (queryStrings['endpoint']) {
        document.getElementById('endpoint').value = queryStrings['endpoint'];
    }
    // Set starting block
    if (queryStrings['start']) {
        document.getElementById('startBlock').value = queryStrings['start'];
    }
    // Set address, and run query from first transaction block to current block
    if (queryStrings['address']) {
        document.getElementById('address').value = queryStrings['address'];
        await graphBalance();
    }
    // Set ending block
    if (queryStrings['end']) {
        document.getElementById('endBlock').value = queryStrings['end'];
    }
    // Adjust range to be what the querystring wants
    if (queryStrings['start'] || queryStrings['end']) {
        Plotly.relayout('graph', 'xaxis.range', [
            document.getElementById('startBlock').value,
            document.getElementById('endBlock').value
        ]);
    }
};
