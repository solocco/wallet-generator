#!/usr/bin/env node
/**
 * Multi-Chain Wallet Generator (Node.js) - Professional Edition
 * Generate Ethereum & Solana wallets with advanced features
 * 
 * Required modules:
 * - npm install ethers
 * - npm install @solana/web3.js
 * - npm install bip39
 * - npm install ed25519-hd-key (for Solana mnemonic derivation)
 * 
 * Usage: node eth-wallet-generator-enhanced.js
 */

const { ethers } = require('ethers');
const { performance } = require('perf_hooks');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

// Solana imports
let solanaWeb3, bip39, Keypair, PublicKey, derivePath;
let SOLANA_AVAILABLE = false;

try {
    solanaWeb3 = require('@solana/web3.js');
    bip39 = require('bip39');
    const ed25519 = require('ed25519-hd-key');
    derivePath = ed25519.derivePath;
    Keypair = solanaWeb3.Keypair;
    PublicKey = solanaWeb3.PublicKey;
    SOLANA_AVAILABLE = true;
} catch(e) {
    // Solana modules not installed
}

// Get CPU info
const CPU_CORES = os.cpus().length;

// Configuration
const CONFIG = {
    MAX_PREFIX_LENGTH: 8,
    MAX_SUFFIX_LENGTH: 8,
    MAX_BULK_WALLETS: 100000,
    MIN_BULK_WALLETS: 1,
    CHECKPOINT_INTERVAL: 100000, // Save checkpoint every 100k attempts
    INVALID_HEX_CHARS: /[^0-9a-fA-F]/g
};

// ============================================
// INPUT VALIDATION
// ============================================
function validateHexString(str, maxLength, fieldName) {
    if (!str) return { valid: true };
    
    // Check for invalid characters
    if (CONFIG.INVALID_HEX_CHARS.test(str)) {
        return {
            valid: false,
            error: `${fieldName} contains invalid characters. Only 0-9, a-f allowed.`
        };
    }
    
    // Check length
    if (str.length > maxLength) {
        return {
            valid: false,
            error: `${fieldName} too long. Maximum ${maxLength} characters for realistic generation time.`
        };
    }
    
    return { valid: true };
}

function validateBulkCount(count) {
    const num = parseInt(count);
    
    if (isNaN(num)) {
        return { valid: false, error: 'Invalid number' };
    }
    
    if (num < CONFIG.MIN_BULK_WALLETS) {
        return { valid: false, error: `Minimum ${CONFIG.MIN_BULK_WALLETS} wallet` };
    }
    
    if (num > CONFIG.MAX_BULK_WALLETS) {
        return { valid: false, error: `Maximum ${CONFIG.MAX_BULK_WALLETS} wallets to prevent memory issues` };
    }
    
    return { valid: true, value: num };
}

// ============================================
// PROBABILITY CALCULATOR
// ============================================
function calculateProbability(prefix, suffix) {
    let totalChars = 0;
    if (prefix) totalChars += prefix.length;
    if (suffix) totalChars += suffix.length;
    
    const attempts = Math.pow(16, totalChars);
    const avgAttempts = attempts / 2;
    
    return {
        totalChars,
        minAttempts: 1,
        avgAttempts: Math.floor(avgAttempts),
        maxAttempts: attempts,
        difficulty: totalChars <= 3 ? 'Easy' : 
                   totalChars <= 5 ? 'Medium' : 
                   totalChars <= 6 ? 'Hard' : 
                   'Very Hard'
    };
}

function estimateTime(attempts, speedPerSecond = 50000) {
    const seconds = attempts / speedPerSecond;
    
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    } else if (seconds < 3600) {
        return `${(seconds/60).toFixed(1)}m`;
    } else if (seconds < 86400) {
        return `${(seconds/3600).toFixed(1)}h`;
    } else {
        return `${(seconds/86400).toFixed(1)}d`;
    }
}

function showProbabilityInfo(prefix, suffix, speedPerSecond = 50000) {
    const prob = calculateProbability(prefix, suffix);
    
    console.log('\n📊 Probability Analysis:');
    console.log(`   Pattern length: ${prob.totalChars} characters`);
    console.log(`   Difficulty: ${prob.difficulty}`);
    console.log(`   Average attempts: ${prob.avgAttempts.toLocaleString()}`);
    console.log(`   Estimated time: ${estimateTime(prob.avgAttempts, speedPerSecond)}`);
    console.log(`   (Based on ${speedPerSecond.toLocaleString()}/s speed)\n`);
    
    if (prob.totalChars > 6) {
        console.log('⚠️  WARNING: This may take a very long time!');
        console.log('💡 TIP: Use multi-threaded mode for better performance\n');
    }
}

// ============================================
// PROGRESS BAR ANIMATION
// ============================================
function drawProgressBar(current, total, barLength = 40) {
    const percentage = (current / total) * 100;
    const filledLength = Math.round((barLength * current) / total);
    const emptyLength = barLength - filledLength;
    
    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(emptyLength);
    
    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinnerFrame = spinner[current % spinner.length];
    
    return `${spinnerFrame} [${filled}${empty}] ${percentage.toFixed(1)}% (${current}/${total})`;
}

// ============================================
// 1. GENERATE SINGLE WALLET (Private Key Only)
// ============================================
function generateSingleWallet() {
    const wallet = ethers.Wallet.createRandom();
    return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: null
    };
}

// ============================================
// 1B. GENERATE WALLET WITH MNEMONIC
// ============================================
function generateWalletWithMnemonic(wordCount = 12) {
    // Supported: 12, 15, 18, 21, 24 words
    const entropyBits = {
        12: 128,
        15: 160,
        18: 192,
        21: 224,
        24: 256
    };
    
    const bits = entropyBits[wordCount] || 128;
    const randomBytes = ethers.randomBytes(bits / 8);
    const mnemonic = ethers.Mnemonic.fromEntropy(randomBytes);
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic);
    
    return {
        address: wallet.address,
        privateKey: wallet.privateKey,
        mnemonic: mnemonic.phrase,
        wordCount: mnemonic.phrase.split(' ').length,
        path: "m/44'/60'/0'/0/0" // Standard Ethereum derivation path
    };
}

// ============================================
// SOLANA WALLET FUNCTIONS
// ============================================

// 1. Generate Solana wallet (Private Key Only)
function generateSolanaSingleWallet() {
    const keypair = Keypair.generate();
    const privateKeyArray = Array.from(keypair.secretKey);
    const privateKeyBase58 = bs58Encode(keypair.secretKey);
    
    return {
        address: keypair.publicKey.toBase58(),
        privateKey: privateKeyBase58,
        privateKeyArray: JSON.stringify(privateKeyArray),
        mnemonic: null
    };
}

// 2. Generate Solana wallet with Mnemonic
function generateSolanaWalletWithMnemonic(wordCount = 12) {
    // Generate mnemonic
    const strength = {
        12: 128,
        15: 160,
        18: 192,
        21: 224,
        24: 256
    };
    
    const mnemonic = bip39.generateMnemonic(strength[wordCount] || 128);
    const seed = bip39.mnemonicToSeedSync(mnemonic, ""); // Empty passphrase
    
    // Use standard Solana derivation path: m/44'/501'/0'/0'
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    
    // Create keypair from derived seed
    const keypair = Keypair.fromSeed(derivedSeed);
    const privateKeyArray = Array.from(keypair.secretKey);
    const privateKeyBase58 = bs58Encode(keypair.secretKey);
    
    return {
        address: keypair.publicKey.toBase58(),
        privateKey: privateKeyBase58,
        privateKeyArray: JSON.stringify(privateKeyArray),
        mnemonic: mnemonic,
        wordCount: mnemonic.split(' ').length,
        path: path
    };
}

// Base58 encoding helper for Solana
function bs58Encode(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const BASE = BigInt(58);
    
    let num = BigInt('0x' + Buffer.from(buffer).toString('hex'));
    let encoded = '';
    
    while (num > 0) {
        const remainder = num % BASE;
        num = num / BASE;
        encoded = ALPHABET[Number(remainder)] + encoded;
    }
    
    // Add leading zeros
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        encoded = ALPHABET[0] + encoded;
    }
    
    return encoded;
}

// Check vanity Solana address
function checkSolanaVanity(address, prefix = null, suffix = null) {
    if (prefix && suffix) {
        return address.startsWith(prefix) && address.endsWith(suffix);
    } else if (prefix) {
        return address.startsWith(prefix);
    } else if (suffix) {
        return address.endsWith(suffix);
    }
    return false;
}

// ============================================
// 2. GENERATE BULK WALLETS (with streaming for large batches)
// ============================================
function generateBulkWallets(count, showDetails = true, withMnemonic = false, wordCount = 12, chain = 'ETH') {
    const chainName = chain === 'SOL' ? 'Solana' : 'Ethereum';
    const walletType = withMnemonic ? `${chainName} wallets with ${wordCount}-word mnemonic` : `${chainName} wallets (private key only)`;
    console.log(`\n🔑 Generating ${count} ${walletType}...\n`);
    
    const wallets = [];
    const startTime = performance.now();
    
    // Use streaming for very large batches
    const useStreaming = count > 10000;
    let fileStream = null;
    
    if (useStreaming) {
        const filename = `wallets-${chain.toLowerCase()}-${withMnemonic ? 'mnemonic-' : ''}${Date.now()}.txt`;
        fileStream = fs.createWriteStream(filename);
        fileStream.write(`# ${chainName} Wallets Generated\n`);
        fileStream.write(`# Type: ${walletType}\n`);
        fileStream.write(`# Date: ${new Date().toISOString()}\n`);
        fileStream.write(`# Total: ${count}\n\n`);
        console.log(`📝 Streaming to file: ${filename}\n`);
    }

    for (let i = 0; i < count; i++) {
        let wallet;
        
        if (chain === 'SOL') {
            wallet = withMnemonic ? generateSolanaWalletWithMnemonic(wordCount) : generateSolanaSingleWallet();
        } else {
            wallet = withMnemonic ? generateWalletWithMnemonic(wordCount) : generateSingleWallet();
        }
        
        if (!useStreaming) {
            wallets.push(wallet);
        } else {
            // Stream to file instead of storing in memory
            fileStream.write(`Wallet ${i + 1}\n`);
            fileStream.write(`Address:     ${wallet.address}\n`);
            fileStream.write(`Private Key: ${wallet.privateKey}\n`);
            if (chain === 'SOL' && wallet.privateKeyArray) {
                fileStream.write(`Private Key (Array): ${wallet.privateKeyArray}\n`);
            }
            if (wallet.mnemonic) {
                fileStream.write(`Mnemonic:    ${wallet.mnemonic}\n`);
                fileStream.write(`Word Count:  ${wallet.wordCount}\n`);
                fileStream.write(`Path:        ${wallet.path}\n`);
            }
            fileStream.write(`\n`);
        }
        
        if (showDetails && count <= 20) {
            console.log(`Wallet ${i + 1}/${count}`);
            console.log(`  Address:     ${wallet.address}`);
            console.log(`  Private Key: ${wallet.privateKey}`);
            if (wallet.mnemonic) {
                console.log(`  Mnemonic:    ${wallet.mnemonic}`);
                console.log(`  Word Count:  ${wallet.wordCount}`);
            }
            console.log('');
        } else {
            const elapsed = (performance.now() - startTime) / 1000;
            const speed = (i + 1) / elapsed;
            const eta = (count - (i + 1)) / speed;
            
            process.stdout.write('\r\x1b[K');
            process.stdout.write(drawProgressBar(i + 1, count));
            process.stdout.write(` | ${speed.toFixed(0)}/s | ETA: ${eta.toFixed(1)}s`);
        }
    }
    
    if (useStreaming && fileStream) {
        fileStream.end();
    }

    if (!showDetails || count > 20) {
        console.log('\n');
    }

    const elapsed = (performance.now() - startTime) / 1000;
    console.log(`✅ Generated ${count} wallets in ${elapsed.toFixed(2)} seconds`);
    console.log(`⚡ Average speed: ${(count/elapsed).toFixed(2)} wallets/second\n`);

    return wallets;
}

// ============================================
// 3. CHECK VANITY ADDRESS
// ============================================
function checkVanity(address, prefix = null, suffix = null) {
    const addr = address.toLowerCase();
    
    if (prefix && suffix) {
        return addr.startsWith('0x' + prefix.toLowerCase()) && 
               addr.endsWith(suffix.toLowerCase());
    } else if (prefix) {
        return addr.startsWith('0x' + prefix.toLowerCase());
    } else if (suffix) {
        return addr.endsWith(suffix.toLowerCase());
    }
    return false;
}

// ============================================
// CHECKPOINT SYSTEM
// ============================================
class CheckpointManager {
    constructor(prefix, suffix) {
        this.filename = `.checkpoint-${prefix || 'x'}-${suffix || 'x'}.json`;
        this.prefix = prefix;
        this.suffix = suffix;
    }
    
    save(attempts, startTime) {
        const data = {
            prefix: this.prefix,
            suffix: this.suffix,
            attempts,
            startTime,
            timestamp: Date.now()
        };
        
        try {
            fs.writeFileSync(this.filename, JSON.stringify(data, null, 2));
        } catch(e) {
            // Silent fail for checkpoint
        }
    }
    
    load() {
        try {
            if (fs.existsSync(this.filename)) {
                const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
                return data;
            }
        } catch(e) {
            // Silent fail
        }
        return null;
    }
    
    delete() {
        try {
            if (fs.existsSync(this.filename)) {
                fs.unlinkSync(this.filename);
            }
        } catch(e) {
            // Silent fail
        }
    }
}

// ============================================
// 4. GENERATE VANITY WALLET (with checkpoint)
// ============================================
async function generateVanityWallet(prefix = null, suffix = null, maxAttempts = 10000000, useCheckpoint = true) {
    // Validate inputs
    if (prefix) {
        const validation = validateHexString(prefix, CONFIG.MAX_PREFIX_LENGTH, 'Prefix');
        if (!validation.valid) {
            console.log(`\n❌ ${validation.error}`);
            return null;
        }
    }
    
    if (suffix) {
        const validation = validateHexString(suffix, CONFIG.MAX_SUFFIX_LENGTH, 'Suffix');
        if (!validation.valid) {
            console.log(`\n❌ ${validation.error}`);
            return null;
        }
    }
    
    console.log('\n🎯 Searching for vanity address...');
    if (prefix) console.log(`   Prefix: 0x${prefix}`);
    if (suffix) console.log(`   Suffix: ${suffix}`);
    
    showProbabilityInfo(prefix, suffix);
    
    console.log(`   Max attempts: ${maxAttempts.toLocaleString()}`);
    console.log(`   💾 Checkpoints: ${useCheckpoint ? 'Enabled' : 'Disabled'}`);
    console.log(`   ⚠️  Press Ctrl+C to stop\n`);

    const checkpoint = useCheckpoint ? new CheckpointManager(prefix, suffix) : null;
    let startTime = performance.now();
    let attempts = 0;
    
    // Try to resume from checkpoint
    if (checkpoint) {
        const saved = checkpoint.load();
        if (saved && saved.prefix === prefix && saved.suffix === suffix) {
            console.log(`📂 Found checkpoint: ${saved.attempts.toLocaleString()} attempts`);
            const resume = await new Promise(resolve => {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question('Resume from checkpoint? (y/n): ', (answer) => {
                    rl.close();
                    resolve(answer.toLowerCase() === 'y');
                });
            });
            
            if (resume) {
                attempts = saved.attempts;
                startTime = performance.now() - (Date.now() - saved.timestamp);
                console.log('✅ Resumed from checkpoint\n');
            } else {
                checkpoint.delete();
                console.log('✅ Starting fresh\n');
            }
        }
    }

    let lastUpdate = 0;
    let lastCheckpoint = 0;
    let cancelled = false;

    const handleCancel = () => {
        cancelled = true;
        console.log('\n\n⚠️  Search cancelled by user');
        console.log(`   Attempts made: ${attempts.toLocaleString()}`);
        const elapsed = (performance.now() - startTime) / 1000;
        console.log(`   Time elapsed: ${elapsed.toFixed(2)}s`);
        console.log(`   Average speed: ${(attempts / elapsed).toFixed(0)}/s`);
        
        if (checkpoint) {
            checkpoint.save(attempts, startTime);
            console.log(`   💾 Progress saved to checkpoint\n`);
        }
        
        process.removeListener('SIGINT', handleCancel);
    };

    process.on('SIGINT', handleCancel);

    return new Promise((resolve) => {
        const searchBatch = () => {
            if (cancelled) {
                resolve(null);
                return;
            }

            for (let i = 0; i < 1000; i++) {
                if (cancelled) {
                    resolve(null);
                    return;
                }

                if (attempts >= maxAttempts) {
                    process.removeListener('SIGINT', handleCancel);
                    console.log(`\n❌ Not found after ${maxAttempts.toLocaleString()} attempts`);
                    if (checkpoint) checkpoint.delete();
                    resolve(null);
                    return;
                }

                attempts++;
                const wallet = generateSingleWallet();

                if (checkVanity(wallet.address, prefix, suffix)) {
                    process.removeListener('SIGINT', handleCancel);
                    const elapsed = (performance.now() - startTime) / 1000;
                    
                    console.log(`\n✅ FOUND after ${attempts.toLocaleString()} attempts in ${elapsed.toFixed(2)}s!`);
                    console.log(`⚡ Speed: ${(attempts / elapsed).toFixed(0)} attempts/second\n`);
                    console.log(`📍 Address:     ${wallet.address}`);
                    console.log(`🔐 Private Key: ${wallet.privateKey}\n`);
                    
                    if (checkpoint) checkpoint.delete();
                    resolve(wallet);
                    return;
                }
            }

            // Update progress display
            if (attempts - lastUpdate >= 1000) {
                lastUpdate = attempts;
                const elapsed = (performance.now() - startTime) / 1000;
                const speed = attempts / elapsed;
                const remaining = maxAttempts - attempts;
                const eta = remaining / speed;
                
                const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                const spinnerFrame = spinner[Math.floor(attempts / 1000) % spinner.length];
                
                process.stdout.write('\r\x1b[K');
                process.stdout.write(`${spinnerFrame} Attempts: ${attempts.toLocaleString()} | Speed: ${speed.toFixed(0)}/s | ETA: ${estimateTime(eta, speed)} | Time: ${elapsed.toFixed(1)}s`);
            }
            
            // Save checkpoint periodically
            if (checkpoint && attempts - lastCheckpoint >= CONFIG.CHECKPOINT_INTERVAL) {
                lastCheckpoint = attempts;
                checkpoint.save(attempts, startTime);
            }

            setImmediate(searchBatch);
        };

        searchBatch();
    });
}

// ============================================
// 5. GENERATE VANITY WALLET (Multi-threaded with better stats)
// ============================================
async function generateVanityWalletMultiThread(prefix = null, suffix = null, threads = null, maxAttempts = 100000000) {
    // Validate inputs
    if (prefix) {
        const validation = validateHexString(prefix, CONFIG.MAX_PREFIX_LENGTH, 'Prefix');
        if (!validation.valid) {
            console.log(`\n❌ ${validation.error}`);
            return null;
        }
    }
    
    if (suffix) {
        const validation = validateHexString(suffix, CONFIG.MAX_SUFFIX_LENGTH, 'Suffix');
        if (!validation.valid) {
            console.log(`\n❌ ${validation.error}`);
            return null;
        }
    }
    
    if (!threads) {
        threads = Math.max(1, CPU_CORES - 1);
    }
    
    console.log('\n🚀 Multi-threaded vanity search...');
    console.log(`   CPU Cores: ${CPU_CORES} detected`);
    console.log(`   Threads: ${threads} (${threads === CPU_CORES ? 'all cores' : 'optimized'})`);
    if (prefix) console.log(`   Prefix: 0x${prefix}`);
    if (suffix) console.log(`   Suffix: ${suffix}`);
    
    showProbabilityInfo(prefix, suffix, 50000 * threads);
    
    console.log(`   Max attempts: ${maxAttempts.toLocaleString()}\n`);

    const startTime = performance.now();
    const attemptsPerThread = Math.floor(maxAttempts / threads);
    let totalAttempts = 0;
    let found = false;
    let lastUpdate = 0;
    let threadStats = Array(threads).fill(0);

    const searchPromises = Array(threads).fill(null).map((_, threadId) => {
        return new Promise((resolve) => {
            let attempts = 0;
            
            const interval = setInterval(() => {
                if (found) {
                    clearInterval(interval);
                    resolve(null);
                    return;
                }

                for (let i = 0; i < 1000; i++) {
                    if (found) break;
                    
                    attempts++;
                    totalAttempts++;
                    threadStats[threadId]++;
                    
                    const wallet = generateSingleWallet();

                    if (checkVanity(wallet.address, prefix, suffix)) {
                        found = true;
                        clearInterval(interval);
                        
                        const elapsed = (performance.now() - startTime) / 1000;
                        
                        console.log(`\n\n✅ FOUND by thread #${threadId + 1}!`);
                        console.log(`   Total attempts: ${totalAttempts.toLocaleString()}`);
                        console.log(`   Time: ${elapsed.toFixed(2)}s`);
                        console.log(`   Speed: ${(totalAttempts / elapsed).toFixed(0)} attempts/second`);
                        console.log(`   Thread efficiency: ${(threadStats[threadId]/totalAttempts*100).toFixed(1)}%\n`);
                        console.log(`📍 Address:     ${wallet.address}`);
                        console.log(`🔐 Private Key: ${wallet.privateKey}\n`);
                        
                        resolve(wallet);
                        return;
                    }

                    if (attempts >= attemptsPerThread) {
                        clearInterval(interval);
                        resolve(null);
                        return;
                    }
                }

                if (totalAttempts - lastUpdate >= 5000) {
                    lastUpdate = totalAttempts;
                    const elapsed = (performance.now() - startTime) / 1000;
                    const speed = totalAttempts / elapsed;
                    const remaining = maxAttempts - totalAttempts;
                    const eta = remaining / speed;
                    
                    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                    const spinnerFrame = spinner[Math.floor(totalAttempts / 5000) % spinner.length];
                    
                    process.stdout.write('\r\x1b[K');
                    process.stdout.write(`${spinnerFrame} Threads: ${threads}/${threads} | Attempts: ${totalAttempts.toLocaleString()} | Speed: ${speed.toFixed(0)}/s | ETA: ${estimateTime(eta, speed)} | Time: ${elapsed.toFixed(1)}s`);
                }
            }, 0);
        });
    });

    const results = await Promise.all(searchPromises);
    const result = results.find(r => r !== null);

    if (!result) {
        console.log(`\n❌ Not found after ${totalAttempts.toLocaleString()} attempts`);
    }

    return result;
}

// ============================================
// 6. SAVE TO FILE
// ============================================
function saveToFile(wallets, filename = 'wallets.txt') {
    const isSolana = wallets[0]?.privateKeyArray !== undefined;
    const chainName = isSolana ? 'Solana' : 'Ethereum';
    
    let content = `# ${chainName} Wallets Generated\n`;
    content += `# Date: ${new Date().toISOString()}\n`;
    content += `# Total: ${wallets.length}\n`;
    content += `# Type: ${wallets[0]?.mnemonic ? 'Mnemonic Phrase' : 'Private Key Only'}\n\n`;

    wallets.forEach((wallet, index) => {
        content += `Wallet ${index + 1}\n`;
        content += `Address:     ${wallet.address}\n`;
        content += `Private Key: ${wallet.privateKey}\n`;
        if (isSolana && wallet.privateKeyArray) {
            content += `Private Key (Array): ${wallet.privateKeyArray}\n`;
        }
        if (wallet.mnemonic) {
            content += `Mnemonic:    ${wallet.mnemonic}\n`;
            content += `Word Count:  ${wallet.wordCount}\n`;
            content += `Path:        ${wallet.path}\n`;
        }
        content += `\n`;
    });

    fs.writeFileSync(filename, content);
    console.log(`💾 Saved to ${filename}`);
    
    return true;
}

// ============================================
// 7. SAVE TO CSV
// ============================================
function saveToCSV(wallets, filename = 'wallets.csv') {
    const hasMnemonic = wallets[0]?.mnemonic !== null && wallets[0]?.mnemonic !== undefined;
    const isSolana = wallets[0]?.privateKeyArray !== undefined;
    
    let content = hasMnemonic 
        ? (isSolana 
            ? 'Index,Address,Private Key (Base58),Private Key (Array),Mnemonic,Word Count,Derivation Path\n'
            : 'Index,Address,Private Key,Mnemonic,Word Count,Derivation Path\n')
        : (isSolana
            ? 'Index,Address,Private Key (Base58),Private Key (Array)\n'
            : 'Index,Address,Private Key\n');

    wallets.forEach((wallet, index) => {
        if (hasMnemonic) {
            const mnemonic = wallet.mnemonic || 'N/A';
            const wordCount = wallet.wordCount || 'N/A';
            const path = wallet.path || 'N/A';
            if (isSolana) {
                content += `${index + 1},${wallet.address},${wallet.privateKey},"${wallet.privateKeyArray}","${mnemonic}",${wordCount},"${path}"\n`;
            } else {
                content += `${index + 1},${wallet.address},${wallet.privateKey},"${mnemonic}",${wordCount},"${path}"\n`;
            }
        } else {
            if (isSolana) {
                content += `${index + 1},${wallet.address},${wallet.privateKey},"${wallet.privateKeyArray}"\n`;
            } else {
                content += `${index + 1},${wallet.address},${wallet.privateKey}\n`;
            }
        }
    });

    fs.writeFileSync(filename, content);
    console.log(`💾 Saved to ${filename}`);
}

// ============================================
// 8. SAVE TO JSON
// ============================================
function saveToJSON(wallets, filename = 'wallets.json') {
    const hasMnemonic = wallets[0]?.mnemonic !== null && wallets[0]?.mnemonic !== undefined;
    const isSolana = wallets[0]?.privateKeyArray !== undefined;
    
    const data = {
        generated: new Date().toISOString(),
        total: wallets.length,
        chain: isSolana ? 'Solana' : 'Ethereum',
        type: hasMnemonic ? 'mnemonic' : 'privatekey',
        wallets: wallets.map((w, i) => {
            const wallet = {
                index: i + 1,
                address: w.address,
                privateKey: w.privateKey
            };
            
            if (isSolana && w.privateKeyArray) {
                wallet.privateKeyArray = w.privateKeyArray;
            }
            
            if (hasMnemonic && w.mnemonic) {
                wallet.mnemonic = w.mnemonic;
                wallet.wordCount = w.wordCount;
                wallet.derivationPath = w.path;
            }
            
            return wallet;
        })
    };
    
    let content = JSON.stringify(data, null, 2);

    fs.writeFileSync(filename, content);
    console.log(`💾 Saved to ${filename}`);
    
    return true;
}

// ============================================
// ETHEREUM WALLET MENU
// ============================================
async function showETHMenu() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log('\n' + '='.repeat(65));
    console.log('🔷 ETHEREUM WALLET GENERATOR');
    console.log('='.repeat(65));
    console.log(`💻 CPU: ${CPU_CORES} cores detected`);
    console.log('='.repeat(65));
    console.log('WALLET GENERATION:');
    console.log('1.  Generate wallets with MNEMONIC PHRASE (12/15/18/21/24 words)');
    console.log('    → Address + Private Key + Mnemonic Seed Phrase');
    console.log('2.  Generate wallets with PRIVATE KEY ONLY');
    console.log('    → Address + Private Key (no mnemonic)');
    console.log('');
    console.log('VANITY ADDRESS (Custom prefix/suffix):');
    console.log('3.  Vanity wallet - Prefix only');
    console.log('4.  Vanity wallet - Suffix only');
    console.log('5.  Vanity wallet - Prefix + Suffix');
    console.log('6.  Vanity wallet - MULTI-THREADED 🚀');
    console.log('');
    console.log('UTILITIES:');
    console.log('7.  Benchmark speed test');
    console.log('0.  Back to main menu');
    console.log('='.repeat(65));

    const choice = await question('\nChoose option (0-7): ');

    switch(choice.trim()) {
        case '1':
            console.log('\n📝 Generate wallets with MNEMONIC PHRASE');
            console.log('   Supported word counts: 12, 15, 18, 21, 24');
            console.log('   Standard is 12 words (recommended)\n');
            
            const wordCountInput = await question('Word count (12/15/18/21/24, default=12): ');
            const wordCount = wordCountInput.trim() === '' ? 12 : parseInt(wordCountInput);
            
            if (![12, 15, 18, 21, 24].includes(wordCount)) {
                console.log('\n❌ Invalid word count! Must be 12, 15, 18, 21, or 24\n');
                break;
            }
            
            const count1 = await question('How many wallets? ');
            const validation1 = validateBulkCount(count1);
            
            if (!validation1.valid) {
                console.log(`\n❌ ${validation1.error}\n`);
                break;
            }
            
            const numCount1 = validation1.value;
            const showDetails1 = numCount1 <= 20;
            
            if (numCount1 > 20) {
                console.log('\n💡 Using animated progress bar (details hidden for large batches)');
            }
            
            if (numCount1 > 10000) {
                console.log('💡 Using streaming mode to prevent memory issues');
            }
            
            const wallets1 = generateBulkWallets(numCount1, showDetails1, true, wordCount, 'ETH');
            
            if (numCount1 <= 10000) {
                const saveChoice1 = await question('Save to file? (1=txt, 2=csv, 3=json, n=no): ');
                if (saveChoice1 === '1') {
                    saveToFile(wallets1, `wallets-mnemonic-${wordCount}words.txt`);
                } else if (saveChoice1 === '2') {
                    saveToCSV(wallets1, `wallets-mnemonic-${wordCount}words.csv`);
                } else if (saveChoice1 === '3') {
                    saveToJSON(wallets1, `wallets-mnemonic-${wordCount}words.json`);
                }
            }
            break;

        case '2':
            console.log('\n🔑 Generate wallets with PRIVATE KEY ONLY');
            console.log('   No mnemonic phrase (cannot be recovered from seed)\n');
            
            const count2 = await question('How many wallets? ');
            const validation2 = validateBulkCount(count2);
            
            if (!validation2.valid) {
                console.log(`\n❌ ${validation2.error}\n`);
                break;
            }
            
            const numCount2 = validation2.value;
            const showDetails2 = numCount2 <= 20;
            
            if (numCount2 > 20) {
                console.log('\n💡 Using animated progress bar (details hidden for large batches)');
            }
            
            if (numCount2 > 10000) {
                console.log('💡 Using streaming mode to prevent memory issues');
            }
            
            const wallets2 = generateBulkWallets(numCount2, showDetails2, false, 12, 'ETH');
            
            if (numCount2 <= 10000) {
                const saveChoice2 = await question('Save to file? (1=txt, 2=csv, 3=json, n=no): ');
                if (saveChoice2 === '1') {
                    saveToFile(wallets2, 'wallets-privatekey.txt');
                } else if (saveChoice2 === '2') {
                    saveToCSV(wallets2, 'wallets-privatekey.csv');
                } else if (saveChoice2 === '3') {
                    saveToJSON(wallets2, 'wallets-privatekey.json');
                }
            }
            break;

        case '3':
            const prefix = await question('Prefix (hex only, max 8 chars, e.g. abc): ');
            const prefixValidation = validateHexString(prefix, CONFIG.MAX_PREFIX_LENGTH, 'Prefix');
            
            if (!prefixValidation.valid) {
                console.log(`\n❌ ${prefixValidation.error}\n`);
                break;
            }
            
            const wallet2 = await generateVanityWallet(prefix, null, 10000000);
            if (wallet2) {
                const save2 = await question('Save to file? (y/n): ');
                if (save2.toLowerCase() === 'y') {
                    saveToFile([wallet2], `vanity-${prefix}.txt`);
                }
            }
            break;

        case '4':
            const suffix = await question('Suffix (hex only, max 8 chars, e.g. 123): ');
            const suffixValidation = validateHexString(suffix, CONFIG.MAX_SUFFIX_LENGTH, 'Suffix');
            
            if (!suffixValidation.valid) {
                console.log(`\n❌ ${suffixValidation.error}\n`);
                break;
            }
            
            const wallet3 = await generateVanityWallet(null, suffix, 10000000);
            if (wallet3) {
                const save3 = await question('Save to file? (y/n): ');
                if (save3.toLowerCase() === 'y') {
                    saveToFile([wallet3], `vanity-${suffix}.txt`);
                }
            }
            break;

        case '5':
            const prefix4 = await question('Prefix (hex only, max 8 chars): ');
            const prefix4Validation = validateHexString(prefix4, CONFIG.MAX_PREFIX_LENGTH, 'Prefix');
            
            if (!prefix4Validation.valid) {
                console.log(`\n❌ ${prefix4Validation.error}\n`);
                break;
            }
            
            const suffix4 = await question('Suffix (hex only, max 8 chars): ');
            const suffix4Validation = validateHexString(suffix4, CONFIG.MAX_SUFFIX_LENGTH, 'Suffix');
            
            if (!suffix4Validation.valid) {
                console.log(`\n❌ ${suffix4Validation.error}\n`);
                break;
            }
            
            const totalChars = prefix4.length + suffix4.length;
            
            if (totalChars > 6) {
                console.log('\n⚠️  WARNING: Prefix + suffix combination may take a VERY long time!');
                const confirm = await question('Continue? (y/n): ');
                if (confirm.toLowerCase() !== 'y') {
                    break;
                }
            }
            
            const wallet4 = await generateVanityWallet(prefix4, suffix4, 100000000);
            if (wallet4) {
                const save4 = await question('Save to file? (y/n): ');
                if (save4.toLowerCase() === 'y') {
                    saveToFile([wallet4], `vanity-${prefix4}-${suffix4}.txt`);
                }
            }
            break;

        case '6':
            console.log(`\n💻 CPU Cores: ${CPU_CORES}`);
            const threadsInput = await question(`Thread count (Enter = auto/${Math.max(1, CPU_CORES-1)}, max ${CPU_CORES}): `);
            let threads = threadsInput.trim() === '' ? null : parseInt(threadsInput);
            
            if (threads && threads > CPU_CORES) {
                console.log(`⚠️  Warning: ${threads} threads > ${CPU_CORES} cores. Using ${CPU_CORES} instead.`);
                threads = CPU_CORES;
            }
            
            const prefix5 = await question('Prefix (hex only, leave empty if none): ');
            const suffix5 = await question('Suffix (hex only, leave empty if none): ');
            
            if (!prefix5 && !suffix5) {
                console.log('❌ Prefix or suffix is required!');
                break;
            }
            
            if (prefix5) {
                const validation5p = validateHexString(prefix5, CONFIG.MAX_PREFIX_LENGTH, 'Prefix');
                if (!validation5p.valid) {
                    console.log(`\n❌ ${validation5p.error}\n`);
                    break;
                }
            }
            
            if (suffix5) {
                const validation5s = validateHexString(suffix5, CONFIG.MAX_SUFFIX_LENGTH, 'Suffix');
                if (!validation5s.valid) {
                    console.log(`\n❌ ${validation5s.error}\n`);
                    break;
                }
            }
            
            const wallet5 = await generateVanityWalletMultiThread(
                prefix5 || null, 
                suffix5 || null, 
                threads,
                100000000
            );
            
            if (wallet5) {
                const save5 = await question('Save to file? (y/n): ');
                const filename = `vanity-${prefix5 || 'x'}-${suffix5 || 'x'}.txt`;
                if (save5.toLowerCase() === 'y') {
                    saveToFile([wallet5], filename);
                }
            }
            break;

        case '7':
            console.log('\n🏎️  Benchmark: Generating 1000 Ethereum wallets...');
            const benchStart = performance.now();
            generateBulkWallets(1000, false, false, 12, 'ETH');
            const benchTime = (performance.now() - benchStart) / 1000;
            const benchSpeed = 1000 / benchTime;
            
            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Speed: ${benchSpeed.toFixed(2)} wallets/second`);
            console.log(`   CPU: ${CPU_CORES} cores`);
            console.log(`   Time per wallet: ${(benchTime/1000*1000).toFixed(2)}ms`);
            
            // Estimate vanity search times
            console.log(`\n💡 Estimated vanity search times (single-threaded):`);
            console.log(`   3 chars: ${estimateTime(Math.pow(16, 3) / 2, benchSpeed)}`);
            console.log(`   4 chars: ${estimateTime(Math.pow(16, 4) / 2, benchSpeed)}`);
            console.log(`   5 chars: ${estimateTime(Math.pow(16, 5) / 2, benchSpeed)}`);
            console.log(`   6 chars: ${estimateTime(Math.pow(16, 6) / 2, benchSpeed)}`);
            break;

        case '0':
            rl.close();
            return 'BACK';

        default:
            console.log('❌ Invalid choice');
    }

    rl.close();
    
    const again = await new Promise(resolve => {
        const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl2.question('\nContinue with Ethereum? (y/n): ', (answer) => {
            rl2.close();
            resolve(answer);
        });
    });

    if (again.toLowerCase() === 'y') {
        return await showETHMenu();
    } else {
        return 'BACK';
    }
}

// ============================================
// SOLANA WALLET MENU
// ============================================
async function showSOLMenu() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log('\n' + '='.repeat(65));
    console.log('☀️  SOLANA WALLET GENERATOR');
    console.log('='.repeat(65));
    console.log(`💻 CPU: ${CPU_CORES} cores detected`);
    console.log('='.repeat(65));
    console.log('WALLET GENERATION:');
    console.log('1.  Generate wallets with MNEMONIC PHRASE (12/15/18/21/24 words)');
    console.log('    → Address + Private Key (Base58 & Array) + Mnemonic');
    console.log('2.  Generate wallets with PRIVATE KEY ONLY');
    console.log('    → Address + Private Key (Base58 & Array)');
    console.log('');
    console.log('UTILITIES:');
    console.log('3.  Benchmark speed test');
    console.log('0.  Back to main menu');
    console.log('='.repeat(65));

    const choice = await question('\nChoose option (0-3): ');

    switch(choice.trim()) {
        case '1':
            console.log('\n📝 Generate Solana wallets with MNEMONIC PHRASE');
            console.log('   Supported word counts: 12, 15, 18, 21, 24');
            console.log('   Standard is 12 words (recommended)\n');
            
            const wordCountInput = await question('Word count (12/15/18/21/24, default=12): ');
            const wordCount = wordCountInput.trim() === '' ? 12 : parseInt(wordCountInput);
            
            if (![12, 15, 18, 21, 24].includes(wordCount)) {
                console.log('\n❌ Invalid word count! Must be 12, 15, 18, 21, or 24\n');
                break;
            }
            
            const count1 = await question('How many wallets? ');
            const validation1 = validateBulkCount(count1);
            
            if (!validation1.valid) {
                console.log(`\n❌ ${validation1.error}\n`);
                break;
            }
            
            const numCount1 = validation1.value;
            const showDetails1 = numCount1 <= 20;
            
            if (numCount1 > 20) {
                console.log('\n💡 Using animated progress bar (details hidden for large batches)');
            }
            
            if (numCount1 > 10000) {
                console.log('💡 Using streaming mode to prevent memory issues');
            }
            
            const wallets1 = generateBulkWallets(numCount1, showDetails1, true, wordCount, 'SOL');
            
            if (numCount1 <= 10000) {
                const saveChoice1 = await question('Save to file? (1=txt, 2=csv, 3=json, n=no): ');
                if (saveChoice1 === '1') {
                    saveToFile(wallets1, `wallets-solana-mnemonic-${wordCount}words.txt`);
                } else if (saveChoice1 === '2') {
                    saveToCSV(wallets1, `wallets-solana-mnemonic-${wordCount}words.csv`);
                } else if (saveChoice1 === '3') {
                    saveToJSON(wallets1, `wallets-solana-mnemonic-${wordCount}words.json`);
                }
            }
            break;

        case '2':
            console.log('\n🔑 Generate Solana wallets with PRIVATE KEY ONLY');
            console.log('   No mnemonic phrase (cannot be recovered from seed)\n');
            
            const count2 = await question('How many wallets? ');
            const validation2 = validateBulkCount(count2);
            
            if (!validation2.valid) {
                console.log(`\n❌ ${validation2.error}\n`);
                break;
            }
            
            const numCount2 = validation2.value;
            const showDetails2 = numCount2 <= 20;
            
            if (numCount2 > 20) {
                console.log('\n💡 Using animated progress bar (details hidden for large batches)');
            }
            
            if (numCount2 > 10000) {
                console.log('💡 Using streaming mode to prevent memory issues');
            }
            
            const wallets2 = generateBulkWallets(numCount2, showDetails2, false, 12, 'SOL');
            
            if (numCount2 <= 10000) {
                const saveChoice2 = await question('Save to file? (1=txt, 2=csv, 3=json, n=no): ');
                if (saveChoice2 === '1') {
                    saveToFile(wallets2, 'wallets-solana-privatekey.txt');
                } else if (saveChoice2 === '2') {
                    saveToCSV(wallets2, 'wallets-solana-privatekey.csv');
                } else if (saveChoice2 === '3') {
                    saveToJSON(wallets2, 'wallets-solana-privatekey.json');
                }
            }
            break;

        case '3':
            console.log('\n🏎️  Benchmark: Generating 1000 Solana wallets...');
            const benchStart = performance.now();
            generateBulkWallets(1000, false, false, 12, 'SOL');
            const benchTime = (performance.now() - benchStart) / 1000;
            const benchSpeed = 1000 / benchTime;
            
            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Speed: ${benchSpeed.toFixed(2)} wallets/second`);
            console.log(`   CPU: ${CPU_CORES} cores`);
            console.log(`   Time per wallet: ${(benchTime/1000*1000).toFixed(2)}ms`);
            break;

        case '0':
            rl.close();
            return 'BACK';

        default:
            console.log('❌ Invalid choice');
    }

    rl.close();
    
    const again = await new Promise(resolve => {
        const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl2.question('\nContinue with Solana? (y/n): ', (answer) => {
            rl2.close();
            resolve(answer);
        });
    });

    if (again.toLowerCase() === 'y') {
        return await showSOLMenu();
    } else {
        return 'BACK';
    }
}

// ============================================
// MAIN MENU - CHAIN SELECTION
// ============================================
async function showMainMenu() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log('\n' + '='.repeat(65));
    console.log('🌟 MULTI-CHAIN WALLET GENERATOR - PROFESSIONAL EDITION');
    console.log('='.repeat(65));
    console.log(`💻 CPU: ${CPU_CORES} cores detected`);
    console.log(`🔗 Chains: Ethereum ${SOLANA_AVAILABLE ? '+ Solana ✅' : '(Solana modules not installed ❌)'}`);
    console.log('='.repeat(65));
    console.log('SELECT BLOCKCHAIN:');
    console.log('1.  Ethereum (ETH) Wallet Generator');
    console.log('    → EVM compatible addresses');
    if (SOLANA_AVAILABLE) {
        console.log('2.  Solana (SOL) Wallet Generator');
        console.log('    → Base58 addresses');
    } else {
        console.log('2.  Solana (SOL) - NOT AVAILABLE');
        console.log('    → Install: npm install @solana/web3.js bip39 ed25519-hd-key');
    }
    console.log('0.  Exit');
    console.log('='.repeat(65));

    const choice = await question(`\nChoose blockchain (0-${SOLANA_AVAILABLE ? '2' : '1'}): `);

    rl.close();

    if (choice.trim() === '1') {
        const result = await showETHMenu();
        if (result === 'BACK') {
            return await showMainMenu();
        }
    } else if (choice.trim() === '2' && SOLANA_AVAILABLE) {
        const result = await showSOLMenu();
        if (result === 'BACK') {
            return await showMainMenu();
        }
    } else if (choice.trim() === '2' && !SOLANA_AVAILABLE) {
        console.log('\n❌ Solana modules not installed!');
        console.log('📦 Install with:');
        console.log('   npm install @solana/web3.js bip39 ed25519-hd-key\n');
        return await showMainMenu();
    } else if (choice.trim() === '0') {
        console.log('\n👋 Goodbye!\n');
        return;
    } else {
        console.log('❌ Invalid choice');
        return await showMainMenu();
    }
}

// ============================================
// MAIN EXECUTION
// ============================================
if (require.main === module) {
    try {
        require.resolve('ethers');
    } catch(e) {
        console.log('\n❌ Module "ethers" not found!');
        console.log('📦 Install it first: npm install ethers\n');
        process.exit(1);
    }

    console.log('\n🌟 Multi-Chain Wallet Generator - Professional Edition');
    console.log(`💻 Detected: ${CPU_CORES} CPU cores`);
    console.log(`⚡ Ready for high-speed generation!\n`);

    showMainMenu().catch(console.error);
}

module.exports = {
    // Ethereum functions
    generateSingleWallet,
    generateWalletWithMnemonic,
    
    // Solana functions
    generateSolanaSingleWallet,
    generateSolanaWalletWithMnemonic,
    
    // Common functions
    generateBulkWallets,
    generateVanityWallet,
    generateVanityWalletMultiThread,
    saveToFile,
    saveToCSV,
    saveToJSON,
    validateHexString,
    validateBulkCount,
    calculateProbability
};
