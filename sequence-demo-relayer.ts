import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { Session, SessionSettingsDefault } from '@0xsequence/auth'
import { ChainId } from '@0xsequence/network'
import { Command } from 'commander'
import inquirer from 'inquirer';
import chalk from 'chalk';
import { BigNumber, ethers } from 'ethers';
import axios from 'axios'

const program = new Command();

import { SequenceIndexerClient } from '@0xsequence/indexer'

const indexer = new SequenceIndexerClient('https://polygon-indexer.sequence.app')
const contractAddress = '0x4574ca5b8b16d8e36d26c7e3dbeffe81f6f031f7'
const providerUrl = 'https://nodes.sequence.app/polygon';
const scanner = 'https://polygonscan.com'
const CHAIN_ID = ChainId.POLYGON
const API_KEY = 'bec3622f-3f4a-4f49-8f62-1bb0e16d0da6';  // Replace with your API key, sh

async function generateOrLoadPrivateKey() {
    const envFilePath = path.join(__dirname, '.env');

    // Check if .env file exists
    if (fs.existsSync(envFilePath)) {
        dotenv.config();

        // Check if pkey exists in .env
        if (process.env.pkey) {
            console.log('Private key already exists in .env file.');
            return process.env.pkey;
        }
    }

    // If not, generate a new wallet and private key
    const wallet = ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey;

    // Write private key to .env file
    fs.appendFileSync(envFilePath, `pkey=${privateKey}\n`);
    console.log('Generated and saved a new private key to .env file.');

    return privateKey;
}

async function fetchPriceCoinMarketCap(currency: string) {
    const headers = {
        'X-CMC_PRO_API_KEY': API_KEY,
        'Accept': 'application/json'
    };

    try {
        const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', { headers: headers });
        const token = response.data.data.find((coin: any) => coin.symbol === currency);

        if (token) {
            return token.quote.USD.price;
        } else {
            console.log(`${currency} not found in response`);
        }
    } catch (error) {
        console.error(`Error fetching Matic ${currency} price from CoinMarketCap:`, error);
    }
}

const getOrderDeadline = (minutesFromNow = 30): number => {
    const nowInSeconds = Math.floor(Date.now() / 1000)
    const offsetInSeconds = 60 * minutesFromNow
    return nowInSeconds + offsetInSeconds
}

program
    .name('sequence-demo-relayer')
    .description(chalk.blue('CLI to claim and send ERC20 tokens called $DEMO.\n\n _____                             \n|   __|___ ___ _ _ ___ ___ ___ ___ \n|__   | -_| . | | | -_|   |  _| -_|\n|_____|___|_  |___|___|_|_|___|___|\n            |_|\n '))
    .version('0.0.1');

program.command('wallet')
    .description('generate a wallet, if not created locally and print wallet address')
    .action((str: any, options: any) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID)

            console.log(chalk.blue(`Your wallet address: ${signer.account.address}`))
        }).catch(error => {
            console.error(`Failed to generate or load private key: ${error}`);
        });
    });

program.command('claim')
    .description('claim some $DEMO token from the faucet')
    .action(async (str: any, options: any) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA
            })
            
            const signer = session.account.getSigner(CHAIN_ID,
                {
                // OPTIONAL: You can also enforce a specific way to pay for gas fees
                // if not provided the sdk will select one for you
                selectFee: async (
                  _txs: any,
                  options: any[]
                ) => {

                    // Find the option to pay with native tokens
                    const found = options[0]

                    const polygonPriceInUSD = await fetchPriceCoinMarketCap('MATIC')

                    // Convert gas price from Gwei to ETH
                    const computeValue = found.value / 1e18;

                    // Convert that USD value to MATIC
                    const maticValue = computeValue * polygonPriceInUSD;

                    const answers = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'userInput',
                            message: chalk.greenBright(`Your tx will cost ${(computeValue.toFixed(8)).toString()} in MATIC ($${maticValue.toFixed(8)} USD), would you like to proceed y/n`),
                        }
                    ]);
            
                    // After getting user input, continue with the function
                    if(answers.userInput == 'y'){
                        return undefined
                    } else {
                        console.log(chalk.red(`User denied tx.`))
                        throw Error('User denied transaction')
                    }
                }
              })

            const demoCoinInterface = new ethers.utils.Interface([
                'function mint()'
            ])
                
            const data = demoCoinInterface.encodeFunctionData(
                'mint', []
            )
                
            const txn = {
                to: contractAddress,
                data
            }

            const res = await signer.sendTransaction(txn, {simulateForFeeOptions: true})
            console.log(`Transaction ID: ${res.hash}`)
            console.log(`URL of Tx: ${scanner}/tx/${res.hash}`)
            const tx = await provider.getTransaction(res.hash);
            const receipt = await provider.getTransactionReceipt(res.hash);
            const gasPrice = tx.gasPrice!;

            const polygonPriceInUSD = await fetchPriceCoinMarketCap('MATIC')
                    
            const totalCostInWei = receipt.gasUsed;
            const gasPriceInUSD = Number(totalCostInWei) * polygonPriceInUSD / 1e9;
            
            console.log(chalk.blackBright(`gas used: ${totalCostInWei} wei ($${gasPriceInUSD.toFixed(8)} USD)`));
            console.log(chalk.cyan(`8 $DEMO coin was transferred to ${signer.account.address}`))
        }).catch(error => {
            console.error(error);
        });
    });

program.command('balance')
    .description('get the user balance of $DEMO coin')
    .action(async () => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID)
            const accountAddress = signer.account.address

            const balance = await indexer.getTokenBalances({
                contractAddress: contractAddress,
                accountAddress: accountAddress,
                includeMetadata: true
            })

            balance.balances.map((token: any) => {
                if(token.contractAddress == contractAddress){
                    console.log(chalk.cyan(`$DEMO balance: ${token.balance}`))
                }
            })
        })
    });

program.command('send')
    .description('send a certain number of tokens to a friends address')
    .argument('<amount>', 'amount to send')
    .argument('<address>', 'wallet address to send to')
    .action((amount, address, options) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID   )

            const erc20Interface = new ethers.utils.Interface([
                'function transfer(address to, uint256 value) public returns (bool)'
            ])
                
            const data = erc20Interface.encodeFunctionData(
                'transfer', [address, amount]
            )
                
            const txn = {
                to: contractAddress,
                data
            }

            try {
                const res = await signer.sendTransaction(txn)
                console.log(`Transaction ID: ${res.hash}`)
                console.log(`URL of Tx: ${scanner}/tx/${res.hash}`)
            } catch(err) {
                console.log(`Something went wrong, check your inputs`)
                console.log(err)
            }
        }).catch(error => {
            console.error(`Failed to generate or load private key: ${error}`);
        });
});

program.command('purchase')
    .description('purchase skyweaver cards from sequence.market')
    .argument('<collection_name>', 'choose the colllection name (e.g. skyweaver')
    .argument('<token_id>', 'a token id to purchase')
    .argument('<max_price>', 'max price to pay for card')
    .action((collection, token_id, price = 2, options) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            if(collection == 'skyweaver'){

                let transactionBatch: any = []

                const provider = new ethers.providers.JsonRpcProvider(providerUrl);

                // Create your server EOA
                const walletEOA = new ethers.Wallet(privateKey, provider);

                // Open a Sequence session, this will find or create
                // a Sequence wallet controlled by your server EOA
                const session = await Session.singleSigner({
                    signer: walletEOA,
                })
                
                const signer = session.account.getSigner(CHAIN_ID)

                const usdcEContract = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
                const niftySwapContract = '0x8bb759bb68995343ff1e9d57ac85ff5c5fb79334'

                const tokenAbi = [
                    "function allowance(address owner, address spender) external view returns (uint256)"
                ];

                const tokenContract = new ethers.Contract(usdcEContract, tokenAbi, provider);

                try {
                    const allowance = await tokenContract.allowance(await signer.getAddress(), niftySwapContract);
                    
                    if(Number(ethers.utils.formatUnits(allowance, 6)) < price){
                        
                        console.log(chalk.blueBright(`info: sending transaction to approve contract`))

                        const approveInterface = new ethers.utils.Interface([
                            'function approve(address spender, uint256 amount) public returns(bool)'
                        ])
            
                        const dataApprove = approveInterface.encodeFunctionData(
                            'approve', [niftySwapContract, ethers.constants.MaxUint256.toString()]
                        )
            
                        const txApprove: any = {
                            to: usdcEContract,
                            data: dataApprove
                        }
                        
                        transactionBatch.push(txApprove)
                    };

                } catch (error) {
                    console.error("Error:", error);
                }

                const niftySwapInterface = new ethers.utils.Interface([
                    `function buyTokens(
                        uint256[] memory _tokenIds,
                        uint256[] memory _tokensBoughtAmounts,
                        uint256 _maxCurrency,
                        uint256 _deadline,
                        address _recipient,
                        address[] memory _extraFeeRecipients,
                        uint256[] memory _extraFeeAmounts
                    )`
                ])

                const data = niftySwapInterface.encodeFunctionData(
                    'buyTokens', [[token_id], [100], price*1e6, getOrderDeadline(), await signer.getAddress(), [], []]
                )
                    
                const txn = {
                    to: '0x8bb759bb68995343ff1e9d57ac85ff5c5fb79334',
                    data
                }

                transactionBatch.push(txn)

                try {
                    const res = await signer.sendTransaction(transactionBatch)
                    console.log(chalk.blueBright(`Skyweaver Card purchase`))
                    console.log('--------------------')
                    console.log(`Transaction ID: ${res.hash}`)
                    console.log(`URL of Tx: ${scanner}/tx/${res.hash}`)
                } catch(err) {
                    console.log(`Something went wrong, check your inputs or increase your price.`)
                    console.log(err)
                }
            } else {
                console.log(chalk.bgMagenta('collection not supported'))
            }
        }).catch(error => {
            console.error(`Failed to generate or load private key: ${error}`);
        });
});

program.parse();