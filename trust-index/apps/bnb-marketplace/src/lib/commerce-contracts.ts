// Extracted verbatim from @bnbagent/sdk 0.5.5 client ABIs and BNB_CHAIN_ADDRESSES.
// SDK has Node-only transitive imports; only its public contract data belongs in the browser.
// Regeneration and source-equality check: tests/commerce-sdk.test.mjs.
export const CONTRACTS = {
  "56": {
    "paymentToken": "0xcE24439F2D9C6a2289F741120FE202248B666666",
    "treasury": "0x000000000000000000000000000000000000dEaD",
    "commerceProxy": "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
    "commerceImpl": "0xd5f9b570c96b5d67702d508c0BFb8B3b09209787",
    "routerProxy": "0x51895229E12F9876011789B04f8698af06cCD6DA",
    "routerImpl": "0xf0Cf8F47e5c035F16247fF16E9F367e477eE5007",
    "policy": "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5"
  },
  "97": {
    "paymentToken": "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    "treasury": "0x1001b2C085345f388778A975648aA50bcfd0D134",
    "commerceProxy": "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
    "commerceImpl": "0x153783DdBDF5233c591965F04644b1df2d1A7815",
    "routerProxy": "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
    "routerImpl": "0x40c0254610d92F1EB9c2D7d5D2114Bc4c99d935E",
    "policy": "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA"
  }
} as const;
export const COMMERCE_ABI = [
{"inputs":[{"internalType":"uint256","name":"jobId","type":"uint256"}],"name":"jobHasBudget","outputs":[{"internalType":"bool","name":"hasBudget","type":"bool"}],"stateMutability":"view","type":"function"},
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "client",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "evaluator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expiredAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "hook",
        "type": "address"
      }
    ],
    "name": "JobCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "deliverable",
        "type": "bytes32"
      }
    ],
    "name": "JobSubmitted",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      }
    ],
    "name": "claimRefund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "evaluator",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "expiredAt",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "description",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "hook",
        "type": "address"
      }
    ],
    "name": "createJob",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expectedBudget",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "optParams",
        "type": "bytes"
      }
    ],
    "name": "fund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      }
    ],
    "name": "getJob",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "id",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "client",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "provider",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "evaluator",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "description",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "budget",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expiredAt",
            "type": "uint256"
          },
          {
            "internalType": "enum IACP.JobStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "hook",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "submittedAt",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "deliverable",
            "type": "bytes32"
          }
        ],
        "internalType": "struct IACP.Job",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paymentToken",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "optParams",
        "type": "bytes"
      }
    ],
    "name": "setBudget",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const ROUTER_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      }
    ],
    "name": "jobPolicy",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "policy",
        "type": "address"
      }
    ],
    "name": "registerJob",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "evidence",
        "type": "bytes"
      }
    ],
    "name": "settle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const POLICY_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "jobId",
        "type": "uint256"
      }
    ],
    "name": "dispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "disputeWindow",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
