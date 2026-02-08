# Multi-Chain Wallet Generator

Professional wallet generator for Ethereum and Solana with mnemonic phrase support, vanity addresses, and bulk generation.

## Installation

```bash
# Install all dependencies
npm install
```

## Usage

```bash
# Run the generator
npm start
```

or

```bash
node wallet-generator.js
```

## Features

### Ethereum (ETH)
- Generate wallets with mnemonic phrase (12/15/18/21/24 words)
- Generate wallets with private key only
- Vanity address generation (prefix/suffix/both)
- Multi-threaded vanity address generation
- Benchmark speed test

### Solana (SOL)
- Generate wallets with mnemonic phrase (12/15/18/21/24 words)
- Generate wallets with private key only
- Benchmark speed test

### Output Formats
- TXT
- CSV
- JSON

## Requirements

- Node.js >= 14.0.0
