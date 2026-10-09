const schema = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (name: string, description: string) => ({ description, content: { 'application/json': { schema: schema(name) } } });
const number = { type: 'number', minimum: 0 };
const integer = { type: 'integer', minimum: 0 };
const transactionSchema = { type: 'object', additionalProperties: false, required: ['hash', 'chainId', 'explorerUrl'], properties: {
  hash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' }, chainId: integer, explorerUrl: { type: 'string', format: 'uri', nullable: true },
} };
const failure = { description: 'Public data is temporarily unavailable. No internal error details are returned.', content: { 'application/json': { schema: { type: 'object', required: ['success', 'message'], properties: { success: { type: 'boolean', enum: [false] }, message: { type: 'string' } } } } } };

export const publicPaths = {
  '/public/overview': { get: {
    tags: ['Public activity'], summary: 'Anonymous public payment metrics', operationId: 'getPublicOverview', security: [],
    description: 'No login required. Only funded orders are counted as payments. Gross transfer volume uses each payment\'s reference USD value once per observed payer deposit, recorded source execution, and confirmed destination delivery. A $10 payment may contribute $30; this is not $30 of customer spending. Completed same-chain swaps count input and output as separate legs even with the same hash; same-asset source/destination delivery with a shared hash counts once. Pending LI.FI delivery, PARTIAL and REFUNDED routes are not completed payouts. Registered users includes waitlist accounts, not unique payers. All dates use UTC. Names, handles, private order IDs, wallet addresses, messages, keys and raw provider data are excluded. Blockchain explorers can still reveal on-chain addresses.',
    responses: { '200': response('PublicOverviewResponse', 'Public aggregate metrics and five recent anonymous payments.'), '500': failure },
  } },
  '/public/payments': { get: {
    tags: ['Public activity'], summary: 'Paginated anonymous payment traces', operationId: 'getPublicPayments', security: [],
    description: 'No login required. One row per funded order, with payer deposit, source execution and destination delivery hashes. Explorer URLs use each transaction\'s own chain. Payer hashes are recovered from Alchemy transfer history when supported and available; unresolved hashes remain unavailable, never substituted with the source execution hash. Provider lookups are bounded and cached. Public IDs are hashes of internal IDs and cannot be used at /orders. Identity filters and unknown/repeated query parameters are rejected.',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100000, default: 1 } },
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 } },
      { name: 'asset', in: 'query', description: 'Exact source token symbol, case-insensitive; any disables this filter.', schema: { type: 'string', maxLength: 32 }, example: 'USDC' },
      { name: 'network', in: 'query', description: 'Exact source network, case-insensitive; any disables this filter.', schema: { type: 'string', maxLength: 32 }, example: 'ethereum' },
      { name: 'date', in: 'query', description: 'UTC payment activity day. Uses paidAt when present, otherwise createdAt.', schema: { type: 'string', format: 'date' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['any', 'completed', 'pending', 'failed'] } },
    ],
    responses: { '200': response('PublicPaymentsResponse', 'A page of anonymous payments; out-of-range pages return an empty array.'), '400': { ...failure, description: 'Invalid filters or pagination, including identity filters and invalid calendar dates.' }, '500': failure },
  } },
};

export const publicSchemas = {
  PublicTransaction: transactionSchema,
  PublicPayment: { type: 'object', additionalProperties: false, required: ['id', 'status', 'dateISO', 'amountUsd', 'volumeUsd', 'transferLegs', 'source', 'destination', 'payerTransactions', 'payerHashStatus', 'sourceTransaction', 'destinationTransaction'], properties: {
    id: { type: 'string', pattern: '^[a-f0-9]{24}$', description: 'Anonymous activity identifier, not the original order ID.' },
    status: { type: 'string', enum: ['completed', 'pending', 'failed'] }, dateISO: { type: 'string', format: 'date' },
    amountUsd: { ...number, description: 'Payment reference value in USD, excluding fees.' },
    volumeUsd: { ...number, description: 'Reference USD amount multiplied by observed transfer legs.' },
    transferLegs: { type: 'integer', minimum: 1, maximum: 3, description: 'Observed deposit plus recorded source execution plus confirmed destination delivery. Swaps count input/output separately; same-asset delivery in a shared transaction counts once. This is not a unique on-chain transaction count.' },
    source: { type: 'object', additionalProperties: false, required: ['network', 'chainId', 'asset', 'amount'], properties: { network: { type: 'string' }, chainId: integer, asset: { type: 'string' }, amount: { type: 'string', description: 'Detected deposit in source-token units.' } } },
    destination: { type: 'object', additionalProperties: false, required: ['network', 'chainId', 'asset'], properties: { network: { type: 'string' }, chainId: { ...integer, nullable: true }, asset: { type: 'string' } } },
    payerTransactions: { type: 'array', items: schema('PublicTransaction') }, payerHashStatus: { type: 'string', enum: ['available', 'unavailable'] },
    sourceTransaction: { ...transactionSchema, nullable: true }, destinationTransaction: { ...transactionSchema, nullable: true },
  } },
  PublicOverview: { type: 'object', additionalProperties: false, required: ['totalVolume', 'paymentVolume', 'totalPayments', 'completedPayments', 'transferLegs', 'totalUsers', 'activeMerchants', 'dailyPayments', 'avgPaymentValue', 'successRate', 'volumeDefinition', 'userDefinition', 'paymentMethods', 'networks', 'volumeSeries', 'recentPayments'], properties: {
    totalVolume: { ...number, description: 'Gross observed transfer volume in reference USD; up to three counts of the same funds.' }, paymentVolume: { ...number, description: 'Completed payment value in USD, counted once.' },
    totalPayments: { ...integer, description: 'Funded orders only. Unpaid/abandoned orders do not count.' }, completedPayments: integer,
    transferLegs: { ...integer, description: 'Observed transfer legs, not unique chain transaction hashes.' },
    totalUsers: { ...integer, description: 'Registered accounts including waitlist users; not unique payers.' }, activeMerchants: { ...integer, description: 'Distinct owners of finished orders; no identities returned.' },
    dailyPayments: { ...integer, description: 'Completed payments since midnight UTC.' }, avgPaymentValue: number, successRate: { ...number, maximum: 100 },
    volumeDefinition: { type: 'string' }, userDefinition: { type: 'string' },
    paymentMethods: { type: 'array', items: schema('AdminPaymentMethod') },
    networks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['network', 'volume', 'payments'], properties: { network: { type: 'string' }, volume: number, payments: integer } } },
    volumeSeries: { type: 'array', minItems: 30, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['date', 'volume'], properties: { date: { type: 'string', format: 'date' }, volume: number } } },
    recentPayments: { type: 'array', maxItems: 5, items: schema('PublicPayment') },
  } },
  PublicOverviewResponse: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', enum: [true] }, data: schema('PublicOverview') } },
  PublicPaymentsResponse: { type: 'object', required: ['success', 'data', 'pagination'], properties: { success: { type: 'boolean', enum: [true] }, data: { type: 'array', items: schema('PublicPayment') }, pagination: schema('PaginationMeta') } },
};
