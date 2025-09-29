import { NitroliteClient as SdkNitroliteClient, WalletStateSigner } from "@erc7824/nitrolite";
import type { Chain } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import env from "../config/environment.js";
import logger from "../utils/logger.js";

export interface NitroliteConnectionArtifacts {
  client: SdkNitroliteClient;
  chain: Chain;
}

export class NitroliteConnectionFactory {
  private readonly chain: Chain;
  private readonly operatorAccount = privateKeyToAccount(env.nitroliteOperatorPrivateKey);

  constructor() {
    this.chain = {
      id: env.nitroliteChainId,
      name: env.nitroliteChainName,
      nativeCurrency: {
        name: "Nitrolite",
        symbol: "NTL",
        decimals: 18,
      },
      rpcUrls: {
        default: {
          http: [env.nitroliteRpcHttpUrl],
          webSocket: [env.nitroliteClearNodeWsUrl],
        },
      },
    } satisfies Chain;
  }

  public create(): NitroliteConnectionArtifacts {
    const account = this.operatorAccount;

    const publicClient = createPublicClient({
      chain: this.chain,
      transport: http(env.nitroliteRpcHttpUrl),
    });

    const walletClient = createWalletClient({
      chain: this.chain,
      account,
      transport: http(env.nitroliteRpcHttpUrl),
    });

    const stateSigner = new WalletStateSigner(walletClient);

    const client = new SdkNitroliteClient({
      publicClient,
      walletClient,
      stateSigner,
      addresses: env.nitroliteContracts,
      chainId: env.nitroliteChainId,
      challengeDuration: env.nitroliteChallengeDurationSeconds,
    });

    logger.debug({ chainId: this.chain.id }, "Created Nitrolite client instance");

    return {
      client,
      chain: this.chain,
    };
  }

  public getOperatorAccount() {
    return this.operatorAccount;
  }
}
