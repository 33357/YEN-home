import { ActionTree, createStore } from "vuex";
import { Ether } from "../network";
import { BigNumber, config, log, utils } from "../const";
import { YENModel } from "yen-sdk";
import { toRaw } from "vue";

export { YENModel } from "yen-sdk";

export interface Storage {}

export interface Sync {
  userAddress: string;
  yenAddress: string;
  chainId: number;
  ether: Ether;
  thisBlock: number;
  thisTime: number;
}

export interface Async {
  share: {
    shareEndBlock: BigNumber;
    totalShareETH: BigNumber;
    totalShareYEN: BigNumber;
    totalLockedPair: BigNumber;
    yourClaimablePair: BigNumber;
    sharer: YENModel.Sharer;
  };
  mint: {
    nextBlockMint: BigNumber;
    yourMinted: BigNumber;
    person: YENModel.Person;
    personBlockList: number[];
    block: { [blockNumber: string]: YENModel.Block };
  };
  stake: {
    person: YENModel.Person;
    yourPairs: BigNumber;
    yourPairAllowance: BigNumber;
    yourReward: BigNumber;
    stakes: BigNumber;
  };
  table: {
    totalSupply: BigNumber;
    halvingBlock: BigNumber;
    feeMul: BigNumber;
    blockMints: BigNumber;
    yenBalance: BigNumber;
  };
}

export interface State {
  storage: Storage;
  sync: Sync;
  async: Async;
}

const state: State = {
  storage: {},
  sync: {
    userAddress: config.ZERO_ADDRESS,
    yenAddress: config.ZERO_ADDRESS,
    chainId: 0,
    ether: new Ether(),
    thisBlock: 0,
    thisTime: 0,
  },
  async: {
    share: {
      shareEndBlock: BigNumber.from(0),
      totalShareETH: BigNumber.from(0),
      totalShareYEN: BigNumber.from(0),
      totalLockedPair: BigNumber.from(0),
      yourClaimablePair: BigNumber.from(0),
      sharer: {
        shares: BigNumber.from(0),
        getteds: BigNumber.from(0),
      },
    },
    mint: {
      nextBlockMint: BigNumber.from(0),
      yourMinted: BigNumber.from(0),
      person: {
        blockIndex: BigNumber.from(0),
        stakes: BigNumber.from(0),
        rewards: BigNumber.from(0),
        lastPerStakeRewards: BigNumber.from(0),
      },
      personBlockList: [],
      block: {},
    },
    stake: {
      person: {
        blockIndex: BigNumber.from(0),
        stakes: BigNumber.from(0),
        rewards: BigNumber.from(0),
        lastPerStakeRewards: BigNumber.from(0),
      },
      stakes: BigNumber.from(0),
      yourPairs: BigNumber.from(0),
      yourPairAllowance: BigNumber.from(0),
      yourReward: BigNumber.from(0),
    },
    table: {
      totalSupply: BigNumber.from(0),
      halvingBlock: BigNumber.from(0),
      feeMul: BigNumber.from(0),
      blockMints: BigNumber.from(0),
      yenBalance: BigNumber.from(0),
    },
  },
};

const actions: ActionTree<State, State> = {
  async start({ dispatch }) {
    try {
      await dispatch("setSync");
      await dispatch("watchStorage");
      log("app start success!");
    } catch (err) {
      log(err);
    }
  },

  async setSync({ state }) {
    await toRaw(state.sync.ether).load();
    if (state.sync.ether.singer && state.sync.ether.provider) {
      let blockNumber;
      [state.sync.userAddress, blockNumber] = await Promise.all([
        toRaw(state.sync.ether.singer).getAddress(),
        toRaw(state.sync.ether.provider).getBlockNumber(),
      ]);
      state.sync.thisBlock = blockNumber;
      const block = await toRaw(state.sync.ether.provider).getBlock(
        state.sync.thisBlock
      );
      state.sync.thisTime = block.timestamp;
    }
    if (state.sync.ether.chainId) {
      state.sync.chainId = state.sync.ether.chainId;
    }
    if (state.sync.ether.yen) {
      state.sync.yenAddress = toRaw(state.sync.ether.yen).address();
    }
  },

  async watchStorage({ state }) {
    const storageName = `${state.sync.userAddress}_${state.sync.chainId}`;
    try {
      const storage = localStorage.getItem(storageName);
      if (storage) {
        utils.deep.clone(state.storage, JSON.parse(storage));
      } else {
        throw new Error("localStorage is empty!");
      }
    } catch (err) {
      localStorage.setItem(storageName, JSON.stringify(state.storage));
    }
    this.watch(
      (state) => state.storage,
      (storage) => {
        localStorage.setItem(storageName, JSON.stringify(storage));
      },
      {
        deep: true,
      }
    );
  },

  async getShareData({ state }) {
    if (state.sync.ether.yen) {
      [
        state.async.share.shareEndBlock,
        state.async.share.totalShareETH,
        state.async.share.totalShareYEN,
        state.async.share.totalLockedPair,
        state.async.share.sharer,
      ] = await Promise.all([
        toRaw(state.sync.ether.yen).shareEndBlock(),
        toRaw(state.sync.ether.yen).shareEths(),
        toRaw(state.sync.ether.yen).shareTokens(),
        toRaw(state.sync.ether.yen).sharePairs(),
        toRaw(state.sync.ether.yen).sharerMap(state.sync.userAddress),
      ]);
      if (state.async.share.totalShareETH.gt(0)) {
        state.async.share.yourClaimablePair = await toRaw(
          state.sync.ether.yen
        ).getShares(state.sync.userAddress);
      }
    }
  },

  async getMintData({ state, dispatch }, func: Function) {
    if (state.sync.ether.yen) {
      let personBlockList;
      [state.async.mint.yourMinted, state.async.mint.person, personBlockList] =
        await Promise.all([
          toRaw(state.sync.ether.yen).getClaims(state.sync.userAddress),
          toRaw(state.sync.ether.yen).personMap(state.sync.userAddress),
          toRaw(state.sync.ether.yen).getPersonBlockList(
            state.sync.userAddress
          ),
        ]);
      state.async.mint.personBlockList = [];
      for (let i = 0; i < Number(state.async.mint.person.blockIndex); i++) {
        state.async.mint.personBlockList.push(personBlockList[i]);
      }
      state.async.mint.personBlockList.reverse();
      state.async.mint.personBlockList.forEach(async (blockNumber) => {
        if (!state.async.mint.block[blockNumber]) {
          await dispatch("getBlock", blockNumber);
        }
        func();
      });
    }
  },

  async getStakeData({ state }) {
    if (state.sync.ether.yen) {
      let pairAddress;
      [
        state.async.stake.person,
        state.async.stake.yourReward,
        pairAddress,
        state.async.stake.stakes,
      ] = await Promise.all([
        toRaw(state.sync.ether.yen).personMap(state.sync.userAddress),
        toRaw(state.sync.ether.yen).getRewards(state.sync.userAddress),
        toRaw(state.sync.ether.yen).pair(),
        toRaw(state.sync.ether.yen).stakes(),
      ]);
      if (!state.sync.ether.pair && pairAddress != config.ZERO_ADDRESS) {
        toRaw(state.sync.ether).loadPair(pairAddress);
      }
      if (state.sync.ether.pair) {
        state.async.stake.yourPairs = await toRaw(
          state.sync.ether.pair
        ).balanceOf(state.sync.userAddress);
        state.async.stake.yourPairAllowance = await toRaw(
          state.sync.ether.pair
        ).allowance(
          state.sync.userAddress,
          toRaw(state.sync.ether.yen).address()
        );
      }
    }
  },

  async getTableData({ state }) {
    if (state.sync.ether.yen) {
      [
        state.async.table.totalSupply,
        state.async.table.halvingBlock,
        state.async.table.feeMul,
        state.async.table.blockMints,
        state.async.table.yenBalance,
      ] = await Promise.all([
        toRaw(state.sync.ether.yen).totalSupply(),
        toRaw(state.sync.ether.yen).halvingBlock(),
        toRaw(state.sync.ether.yen).getFeeMul(),
        toRaw(state.sync.ether.yen).blockMints(),
        toRaw(state.sync.ether.yen).balanceOf(state.sync.yenAddress),
      ]);
    }
  },

  async mint({ state }, func: Function) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).mint({}, func);
    }
  },

  async claim({ state }, func: Function) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).claim({}, func);
    }
  },

  async share({ state }, { shares, func }) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).share({ value: shares }, func);
    }
  },

  async getShare({ state }, func: Function) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).getShare({}, func);
    }
  },

  async approve({ state }, func: Function) {
    if (state.sync.ether.pair && state.sync.ether.yen) {
      await toRaw(state.sync.ether.pair).approve(
        toRaw(state.sync.ether.yen).address(),
        BigNumber.from(config.MAX_UINT256),
        {},
        func
      );
    }
  },

  async stake({ state }, { stakes, func }) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).stake(stakes, {}, func);
    }
  },

  async withdrawStake({ state }, { withdrawStakes, func }) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).withdrawStake(withdrawStakes, {}, func);
    }
  },

  async withdrawReward({ state }, func: Function) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).withdrawReward({}, func);
    }
  },

  async exit({ state }, func: Function) {
    if (state.sync.ether.yen) {
      await toRaw(state.sync.ether.yen).exit({}, func);
    }
  },

  async getBlock({ state }, blockNumber: number) {
    if (state.sync.ether.yen) {
      state.async.mint.block[blockNumber] = {
        persons: BigNumber.from(0),
        mints: BigNumber.from(0),
      };
      state.async.mint.block[blockNumber] = await toRaw(
        state.sync.ether.yen
      ).blockMap(blockNumber);
    }
  },

  async getBlockMintData({ state }) {
    if (state.sync.ether.yen) {
      const [nextBlockMint, blockMints] = await Promise.all([
        toRaw(state.sync.ether.yen).getMints(),
        toRaw(state.sync.ether.yen).blockMints(),
      ]);
      state.async.mint.nextBlockMint = nextBlockMint.div(2).add(blockMints);
    }
  },

  async getBlockData({ state, dispatch }, func: Function) {
    if (state.sync.ether.provider && state.sync.ether.yen) {
      const blockNumber = await toRaw(
        state.sync.ether.provider
      ).getBlockNumber();
      if (!state.async.mint.block[blockNumber]) {
        dispatch("getBlockMintData");
        for (
          let runBlockNumber = state.sync.thisBlock;
          runBlockNumber <= blockNumber;
          runBlockNumber++
        ) {
          if (!state.async.mint.block[runBlockNumber]) {
            await dispatch("getBlock", runBlockNumber);
            func(runBlockNumber);
          }
        }
      }
    }
  },
};

export default createStore({
  state,
  actions,
});
