/**
 * OpenAPI 3.0 specification for the Payli HTTP API.
 *
 * This document is hand-authored (rather than generated from inline JSDoc
 * comments) so it compiles straight into `dist/` and behaves identically in
 * development and inside the Docker image — nothing needs the TypeScript source
 * to be present at runtime.
 *
 * It is served from `src/index.ts` two ways:
 *   - Interactive Swagger UI ... GET /docs
 *   - Raw JSON document ........ GET /docs.json  (import into Postman / Insomnia,
 *                                                 client codegen, etc.)
 *
 * Keep this in sync with the route handlers in `src/controllers/*`. Every status
 * code documented below is one the controllers actually return.
 */

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Payli HTTP API',
    version: '0.1.0',
    description: [
      'HTTP API behind **Payli** — crypto donation links and the payment orders',
      'created from them.',
      '',
      '### How it fits together',
      '- A **donation link** (`/donations/{username}`) is a public handle that maps to a',
      '  merchant and a payout destination. The payout destination and owning user are',
      '  resolved server-side and never exposed on the public endpoints.',
      '- Creating an **order** (`POST /orders`) from a donation link generates a fresh',
      '  multi-chain set of deposit addresses (EVM, Tron, Solana, Stellar, Bitcoin),',
      '  snapshots the latest exchange rates, computes per-network/per-token pricing',
      '  (amount + service fee + network fee), and returns the hosted payment-gateway',
      '  URL the donor is redirected to.',
      '- An order stays payable for **20 minutes** (`expiresAt`); pricing is computed',
      '  against a rates snapshot that must be **under 30 seconds old**, otherwise',
      '  creation is rejected with `503`.',
      '',
      '### Conventions',
      '- All endpoints return JSON.',
      '- Resource endpoints wrap their payload as `{ "success": boolean, ... }`.',
      '  On success the body carries a `data` field; on failure a `message` (and, for',
      '  unexpected `500`s, an `error` string).',
      '- There is **no authentication** on these endpoints — they are public read /',
      '  create operations for the donation flow.',
      '- Unknown routes return `404 { "message": "Route not found" }` and any uncaught',
      '  server error returns `500 { "message": "Something went wrong!", "error": "..." }`.',
    ].join('\n'),
    contact: { name: 'Payli', url: 'https://payli.to' },
    license: { name: 'MIT' },
  },

  servers: [
    { url: '/', description: 'This host (relative — "Try it out" hits the same origin)' },
    { url: 'http://localhost:3000', description: 'Local development (default PORT)' },
    { url: 'http://127.0.0.1:3030', description: 'Local Docker (compose maps 3030 → 3000)' },
    { url: 'https://api.payli.to', description: 'Production (example — adjust to your deployment)' },
  ],

  tags: [
    { name: 'Health', description: 'Liveness / readiness checks.' },
    { name: 'Config', description: 'Supported blockchain networks and tokens.' },
    { name: 'Donations', description: 'Public donation links.' },
    { name: 'Orders', description: 'Donation orders and their multi-chain payment pricing.' },
  ],

  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Returns `200` while the server process is up and accepting requests.',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'Server is running.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: { status: 'OK', message: 'Server is running' },
              },
            },
          },
        },
      },
    },

    '/config': {
      get: {
        tags: ['Config'],
        summary: 'Get supported networks and tokens',
        description: [
          'Returns the full catalogue of blockchain networks and tokens the platform',
          'knows about. Use `isAllowed` on each network/token to decide what to show as',
          'selectable — disallowed entries are returned for reference but are not',
          'currently accepted for payouts.',
        ].join('\n'),
        operationId: 'getConfig',
        responses: {
          '200': {
            description: 'The network and token catalogue.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ConfigResponse' },
              },
            },
          },
        },
      },
    },

    '/donations/{username}': {
      get: {
        tags: ['Donations'],
        summary: 'Get a donation link by username',
        description: [
          'Looks up a public donation link by its handle. The lookup is',
          'case-insensitive and whitespace-trimmed (handles are stored lowercase).',
          '',
          'The payout destination (`destinationToken` / `destinationNetwork` /',
          '`destinationAddress`) and the owning `user` are intentionally **omitted** —',
          'they are resolved server-side when an order is created.',
        ].join('\n'),
        operationId: 'getDonationByUsername',
        parameters: [
          {
            name: 'username',
            in: 'path',
            required: true,
            description: 'Public donation handle (case-insensitive).',
            schema: { type: 'string', example: 'matin' },
          },
        ],
        responses: {
          '200': {
            description: 'The donation link was found.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DonationLinkResponse' },
              },
            },
          },
          '404': {
            description: 'No donation link exists for that username.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { success: false, message: 'Donation link not found' },
              },
            },
          },
          '500': {
            description: 'Unexpected error while fetching the donation link.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: {
                  success: false,
                  message: 'Error fetching donation link',
                  error: 'Unknown error',
                },
              },
            },
          },
        },
      },
    },

    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Create an order from a donation link',
        description: [
          'Creates a payable order against a donation link. The donor supplies an',
          '`amount` (USD) and an optional `text` message; the payout destination and',
          'owning merchant are copied from the referenced donation link.',
          '',
          'On creation the server:',
          '1. Validates the amount (must be a valid number greater than zero).',
          '2. Resolves the donation link by its MongoDB id (`donationId`).',
          '3. Loads the latest exchange-rate snapshot and rejects the request with',
          '   `503` if no snapshot exists or it is older than 30 seconds.',
          '4. Generates a fresh deposit wallet across every supported chain and a',
          '   smart-account address.',
          '5. Computes per-network / per-token pricing and persists the order with a',
          '   20-minute expiry.',
          '',
          'Returns the order id and the hosted gateway URL the donor should be sent to.',
        ].join('\n'),
        operationId: 'createOrder',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateOrderRequest' },
              examples: {
                minimal: {
                  summary: 'Minimal — amount + donation link',
                  value: { amount: '10', donationId: '665f1b2c3d4e5f6a7b8c9d0e' },
                },
                withMessage: {
                  summary: 'With an optional donor message',
                  value: {
                    amount: '25.5',
                    donationId: '665f1b2c3d4e5f6a7b8c9d0e',
                    text: 'Thanks for the great work!',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order created. The donor should be redirected to `data.url`.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateOrderResponse' },
                example: {
                  success: true,
                  data: { id: 'a1b2c3d4e5', url: 'https://pay.payli.to/a1b2c3d4e5' },
                },
              },
            },
          },
          '400': {
            description: 'Validation failed (bad amount or donationId).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: {
                  invalidAmount: {
                    summary: 'Missing or non-numeric amount',
                    value: { success: false, message: 'A valid amount is required' },
                  },
                  nonPositiveAmount: {
                    summary: 'Amount is zero or negative',
                    value: { success: false, message: 'Amount must be greater than zero' },
                  },
                  invalidDonationId: {
                    summary: 'Missing or malformed donationId',
                    value: { success: false, message: 'A valid donationId is required' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'No donation link exists for the supplied `donationId`.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { success: false, message: 'Donation link not found' },
              },
            },
          },
          '503': {
            description: 'Exchange-rate snapshot is unavailable or stale; try again shortly.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                examples: {
                  noRates: {
                    summary: 'No rates snapshot available',
                    value: {
                      success: false,
                      message: 'Cannot fetch exchange rates. Please try later.',
                    },
                  },
                  staleRates: {
                    summary: 'Latest snapshot is older than 30s',
                    value: { success: false, message: 'Rates data is outdated. Please try again.' },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Unexpected error while creating the order.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: {
                  success: false,
                  message: 'Failed to create order',
                  error: 'Unknown error',
                },
              },
            },
          },
        },
      },
    },

    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get an order by id',
        description: [
          'Fetches a payable order by its public short id (the `id` field returned from',
          '`POST /orders` — **not** the MongoDB `_id`).',
          '',
          'Sensitive fields (private key, payout destination, owning user, receipt',
          'metadata, linked payment) are stripped from the response. The `rates`',
          'snapshot the order was priced against is populated inline.',
          '',
          '**Note on the response shape:** while the order is `pending`, `data` is the',
          'full order object. Once it has moved to any other status, `data` is instead a',
          'human-readable string such as `"Order is finished"` — pricing/addresses are',
          'no longer returned because the order is no longer payable.',
        ].join('\n'),
        operationId: 'getOrderById',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Public short order id (10-character hex), as returned by `POST /orders`.',
            schema: { type: 'string', example: 'a1b2c3d4e5' },
          },
        ],
        responses: {
          '200': {
            description:
              'Order found. `data` is the full order while `pending`, or a status string otherwise.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderLookupResponse' },
                examples: {
                  pending: {
                    summary: 'Pending order (full payload)',
                    value: {
                      success: true,
                      data: {
                        _id: '665f1b2c3d4e5f6a7b8c9d0e',
                        id: 'a1b2c3d4e5',
                        amount: '10',
                        status: 'pending',
                        smartAccount: '0x1234abcd5678ef901234abcd5678ef901234abcd',
                        evmAddress: '0x9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
                        tronAddress: 'TQ5n8a1Hh2yKqC7s9fW3xR4vB6mP8dJ2kL',
                        solanaAddress: '7vH9k2qY8nT4xR1mD3wF6sG5pL0jB2cA9eK4uN1oZ8',
                        stellarAddress: 'GСKFBEIYTKP5RDBQMUTAPDCFHADYDADZ5UBVFXVZ',
                        bitcoinLegacyAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
                        bitcoinSegwitAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                        expiresAt: '2026-06-27T12:20:00.000Z',
                        createdAt: '2026-06-27T12:00:00.000Z',
                        updatedAt: '2026-06-27T12:00:00.000Z',
                        text: 'Thanks for the great work!',
                        donation: '665f1b2c3d4e5f6a7b8c9d0f',
                        rates: {
                          BTC: 64000, ETH: 3500, BNB: 600, XLM: 0.11, TRX: 0.12,
                          USDC: 1, SOL: 150, CELO: 0.7, POL: 0.55, USDT: 1,
                          createdAt: '2026-06-27T11:59:45.000Z',
                          updatedAt: '2026-06-27T11:59:45.000Z',
                        },
                        pricing: [
                          {
                            network: 'ethereum',
                            networkFeeUsd: '2',
                            tokens: [
                              {
                                symbol: 'USDC',
                                priceUsd: '1',
                                amountUsd: '10',
                                amount: '10',
                                serviceFeeUsd: '0.5',
                                serviceFee: '0.5',
                                networkFeeUsd: '2',
                                networkFee: '2',
                                totalUsd: '12.5',
                                total: '12.5',
                              },
                            ],
                          },
                        ],
                      },
                    },
                  },
                  settled: {
                    summary: 'Non-pending order (status string)',
                    value: { success: true, data: 'Order is finished' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'No order exists for that id.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { success: false, message: 'Order not found' },
              },
            },
          },
          '500': {
            description: 'Unexpected error while fetching the order.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: {
                  success: false,
                  message: 'Error fetching order',
                  error: 'Unknown error',
                },
              },
            },
          },
        },
      },
    },
  },

  components: {
    schemas: {
      // ----- Generic envelopes -------------------------------------------------
      ErrorResponse: {
        type: 'object',
        description: 'Standard failure envelope returned by the resource endpoints.',
        required: ['success', 'message'],
        properties: {
          success: { type: 'boolean', enum: [false], example: false },
          message: {
            type: 'string',
            description: 'Human-readable summary of what went wrong.',
            example: 'Donation link not found',
          },
          error: {
            type: 'string',
            nullable: true,
            description: 'Underlying error detail. Only present on unexpected `500` responses.',
            example: 'Unknown error',
          },
        },
      },

      HealthResponse: {
        type: 'object',
        required: ['status', 'message'],
        properties: {
          status: { type: 'string', example: 'OK' },
          message: { type: 'string', example: 'Server is running' },
        },
      },

      // ----- Config: tokens & networks ----------------------------------------
      ContractAddresses: {
        type: 'object',
        description:
          'ERC-20 contract addresses per EVM network. Empty (`{}`) for native assets. Keys are network identifiers.',
        additionalProperties: { type: 'string' },
        properties: {
          mainnet: { type: 'string', example: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
          bsc: { type: 'string', example: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
          polygon: { type: 'string', example: '0x3c499959c92e8d5b2b6d8b6e9d8b6e9d8b6e9d8b' },
          base: { type: 'string', example: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
          arbitrum: { type: 'string', example: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
          optimism: { type: 'string', example: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
          celoMainnet: { type: 'string', example: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C' },
        },
      },

      Token: {
        type: 'object',
        description: 'A supported asset.',
        required: ['symbol', 'name', 'decimals', 'isAllowed'],
        properties: {
          symbol: { type: 'string', example: 'USDC' },
          name: { type: 'string', example: 'USD Coin' },
          decimals: { type: 'integer', example: 6 },
          isAllowed: {
            type: 'boolean',
            description: 'Whether the asset is currently accepted.',
            example: true,
          },
          isNative: {
            type: 'boolean',
            description: 'True for an L1/L2 native gas asset (e.g. ETH, BNB, SOL).',
            example: true,
          },
          isNonEvm: {
            type: 'boolean',
            description: 'True for non-EVM assets (BTC, SOL, XLM, TRX).',
            example: true,
          },
          contractAddresses: { $ref: '#/components/schemas/ContractAddresses' },
        },
      },

      Network: {
        type: 'object',
        description: 'A supported blockchain network.',
        required: ['id', 'name', 'type', 'isAllowed', 'rpcUrl', 'blockExplorer', 'nativeToken', 'supportedTokens'],
        properties: {
          id: { type: 'string', example: 'ethereum' },
          name: { type: 'string', example: 'Ethereum' },
          chainId: {
            type: 'integer',
            nullable: true,
            description: 'EVM chain id. Absent for non-EVM networks (Bitcoin, Solana, Stellar, Tron).',
            example: 1,
          },
          type: { type: 'string', enum: ['evm', 'non-evm'], example: 'evm' },
          isAllowed: { type: 'boolean', example: true },
          rpcUrl: { type: 'string', format: 'uri', example: 'https://eth.llamarpc.com' },
          blockExplorer: { type: 'string', format: 'uri', example: 'https://etherscan.io' },
          nativeToken: { $ref: '#/components/schemas/Token' },
          supportedTokens: {
            type: 'array',
            items: { $ref: '#/components/schemas/Token' },
          },
        },
      },

      ConfigResponse: {
        type: 'object',
        required: ['networks', 'tokens'],
        properties: {
          networks: {
            type: 'array',
            description: 'Every known network (allowed and not).',
            items: { $ref: '#/components/schemas/Network' },
          },
          tokens: {
            type: 'array',
            description: 'Every known token (allowed and not).',
            items: { $ref: '#/components/schemas/Token' },
          },
        },
      },

      // ----- Donations ---------------------------------------------------------
      DonationLinkPublic: {
        type: 'object',
        description:
          'Public view of a donation link. The payout destination and owning user are intentionally omitted.',
        properties: {
          _id: { type: 'string', description: 'MongoDB id.', example: '665f1b2c3d4e5f6a7b8c9d0f' },
          username: { type: 'string', example: 'matin' },
          custom: {
            type: 'boolean',
            description:
              'True when the link was created with a one-off custom destination rather than the owner’s saved default.',
            example: false,
          },
          createdAt: { type: 'string', format: 'date-time', example: '2026-06-20T09:00:00.000Z' },
          updatedAt: { type: 'string', format: 'date-time', example: '2026-06-20T09:00:00.000Z' },
        },
      },

      DonationLinkResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true], example: true },
          data: { $ref: '#/components/schemas/DonationLinkPublic' },
        },
      },

      // ----- Rates -------------------------------------------------------------
      Rates: {
        type: 'object',
        description: 'A USD price snapshot keyed by asset symbol.',
        properties: {
          BTC: { type: 'number', example: 64000 },
          ETH: { type: 'number', example: 3500 },
          BNB: { type: 'number', example: 600 },
          XLM: { type: 'number', example: 0.11 },
          TRX: { type: 'number', example: 0.12 },
          USDC: { type: 'number', example: 1 },
          SOL: { type: 'number', example: 150 },
          CELO: { type: 'number', example: 0.7 },
          POL: { type: 'number', example: 0.55 },
          USDT: { type: 'number', example: 1 },
          createdAt: { type: 'string', format: 'date-time', example: '2026-06-27T11:59:45.000Z' },
          updatedAt: { type: 'string', format: 'date-time', example: '2026-06-27T11:59:45.000Z' },
        },
      },

      // ----- Order pricing -----------------------------------------------------
      OrderTokenPricing: {
        type: 'object',
        description:
          'Pricing for one token on one network. All monetary values are decimal strings to preserve precision.',
        properties: {
          symbol: { type: 'string', example: 'USDC' },
          priceUsd: { type: 'string', description: 'USD price of 1 unit of the token.', example: '1' },
          amountUsd: { type: 'string', description: 'Donation amount in USD.', example: '10' },
          amount: { type: 'string', description: 'Donation amount denominated in the token.', example: '10' },
          serviceFeeUsd: { type: 'string', description: 'Platform service fee in USD.', example: '0.5' },
          serviceFee: { type: 'string', description: 'Service fee in the token.', example: '0.5' },
          networkFeeUsd: { type: 'string', description: 'Network (gas) fee in USD.', example: '2' },
          networkFee: { type: 'string', description: 'Network fee in the token.', example: '2' },
          totalUsd: { type: 'string', description: 'amount + service fee + network fee, in USD.', example: '12.5' },
          total: { type: 'string', description: 'Grand total in the token (what the donor pays).', example: '12.5' },
        },
      },

      OrderNetworkPricing: {
        type: 'object',
        description: 'Pricing for every supported token on a single network.',
        properties: {
          network: { type: 'string', example: 'ethereum' },
          networkFeeUsd: { type: 'string', example: '2' },
          tokens: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderTokenPricing' },
          },
        },
      },

      // ----- Orders ------------------------------------------------------------
      OrderStatus: {
        type: 'string',
        description: 'Lifecycle state of an order.',
        enum: ['pending', 'processing', 'finished', 'expired', 'failed', 'manual_review'],
        example: 'pending',
      },

      OrderPublic: {
        type: 'object',
        description:
          'Public view of a payable order. Private key, payout destination, owning user, receipt metadata and linked payment are stripped out.',
        properties: {
          _id: { type: 'string', example: '665f1b2c3d4e5f6a7b8c9d0e' },
          id: { type: 'string', description: 'Public short id used in the gateway URL.', example: 'a1b2c3d4e5' },
          amount: { type: 'string', description: 'Requested donation amount in USD.', example: '10' },
          status: { $ref: '#/components/schemas/OrderStatus' },
          smartAccount: { type: 'string', description: 'Smart-account address.', example: '0x1234abcd5678ef901234abcd5678ef901234abcd' },
          evmAddress: { type: 'string', description: 'Deposit address shared by all EVM chains.', example: '0x9f8e7d6c5b4a39281706f5e4d3c2b1a098765432' },
          tronAddress: { type: 'string', example: 'TQ5n8a1Hh2yKqC7s9fW3xR4vB6mP8dJ2kL' },
          solanaAddress: { type: 'string', example: '7vH9k2qY8nT4xR1mD3wF6sG5pL0jB2cA9eK4uN1oZ8' },
          stellarAddress: { type: 'string', example: 'GCKFBEIYTKP5RDBQMUTAPDCFHADYDADZ5UBVFXVZ7ULNMVQ4WSYNKL2P' },
          bitcoinLegacyAddress: { type: 'string', example: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
          bitcoinSegwitAddress: { type: 'string', example: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' },
          createdAt: { type: 'string', format: 'date-time', example: '2026-06-27T12:00:00.000Z' },
          expiresAt: { type: 'string', format: 'date-time', description: 'When the order stops being payable (20 minutes after creation).', example: '2026-06-27T12:20:00.000Z' },
          updatedAt: { type: 'string', format: 'date-time', example: '2026-06-27T12:00:00.000Z' },
          text: { type: 'string', nullable: true, description: 'Optional donor message.', example: 'Thanks for the great work!' },
          donation: { type: 'string', nullable: true, description: 'MongoDB id of the source donation link.', example: '665f1b2c3d4e5f6a7b8c9d0f' },
          rates: { $ref: '#/components/schemas/Rates' },
          pricing: {
            type: 'array',
            description: 'Per-network, per-token pricing the donor can choose from.',
            items: { $ref: '#/components/schemas/OrderNetworkPricing' },
          },
        },
      },

      OrderLookupResponse: {
        type: 'object',
        description:
          'Response for `GET /orders/{id}`. `data` is the full order while pending, or a status string otherwise.',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true], example: true },
          data: {
            oneOf: [
              { $ref: '#/components/schemas/OrderPublic' },
              {
                type: 'string',
                description: 'Status message returned when the order is no longer pending.',
                example: 'Order is finished',
              },
            ],
          },
        },
      },

      CreateOrderRequest: {
        type: 'object',
        required: ['amount', 'donationId'],
        properties: {
          amount: {
            type: 'string',
            description:
              'Donation amount in USD. Must be greater than zero. Accepts a numeric string (recommended, to avoid float precision issues) or a JSON number.',
            example: '10',
          },
          donationId: {
            type: 'string',
            description: 'MongoDB id (`_id`) of the donation link to create the order from.',
            pattern: '^[a-fA-F0-9]{24}$',
            example: '665f1b2c3d4e5f6a7b8c9d0e',
          },
          text: {
            type: 'string',
            description: 'Optional free-text message from the donor, shown to the merchant.',
            example: 'Thanks for the great work!',
          },
        },
      },

      CreateOrderResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true], example: true },
          data: {
            type: 'object',
            required: ['id', 'url'],
            properties: {
              id: { type: 'string', description: 'Public short order id.', example: 'a1b2c3d4e5' },
              url: {
                type: 'string',
                format: 'uri',
                description: 'Hosted payment-gateway URL the donor should be redirected to.',
                example: 'https://pay.payli.to/a1b2c3d4e5',
              },
            },
          },
        },
      },
    },
  },
};

export type OpenApiDocument = typeof openApiDocument;
