import envil from 'envil';

export const envs = () => {
  const envVariables = ['DB_URI', 'DB_NAME', 'NODE_ENV', 'PORT'];

  return envil(envVariables, { returnValues: true });
};
