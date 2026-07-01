import envil from 'envil';

export const envs = () => {
  const envVariables = [
    'DB_URI',
    'DB_NAME',
    'NODE_ENV',
    'PORT',
    'PAYMENT_GATEWAY_URI',
    'ALCHEMY_API_KEY',
  ];

  return envil(envVariables, { returnValues: true });
};
