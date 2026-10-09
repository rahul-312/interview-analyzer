export interface User {
  id: number;
  username: string;
  email: string;
  first_name: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface RegisterInput {
  username: string;
  password: string;
  email?: string;
  first_name?: string;
}
