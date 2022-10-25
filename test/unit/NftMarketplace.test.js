const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Nft Marketplace Unit Tests", function () {
        let nftMarketplace, nftMarketplaceContract, basicNft, basicNftContract
        const PRICE = ethers.utils.parseEther("0.1")
        const TOKEN_ID = 0

        beforeEach(async () => {
            accounts = await ethers.getSigners() // could also do with getNamedAccounts
            deployer = accounts[0]
            user = accounts[1]
            await deployments.fixture(["all"])
            nftMarketplaceContract = await ethers.getContract("NftMarketplace")
            nftMarketplace = nftMarketplaceContract.connect(deployer)
            basicNftContract = await ethers.getContract("BasicNft")
            basicNft = await basicNftContract.connect(deployer)
            await basicNft.mintNft()
            await basicNft.approve(nftMarketplaceContract.address, TOKEN_ID)
        })

        describe("listItem", function () {
            it("emits an event after listing an item", async function () {
                expect(await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)).to.emit(
                    "ItemListed"
                )
            })
            it("can't list an item already listed", async function() {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                await expect(
                    nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                ).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__AlreadyListed"
                );
            })
            it('cannot list if not the owner', async function() {
                await expect(nftMarketplace.connect(user).listItem(basicNft.address, TOKEN_ID, PRICE)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotOwner"
                )
            })
            it('needs approval to list item', async function() {
                await basicNft.approve(ethers.constants.AddressZero, TOKEN_ID) 
                await expect(
                    nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                ).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotApprovedForMarketplace"
                )
            })
            it('updates listing with seller and price', async function() {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID)
                assert(listing.price.toString() == PRICE.toString())
                assert(listing.seller.toString() == deployer.address)
            })
        })
        describe("cancelListing", function () {
            it("reverts if there is no listing", async function () {
                await expect(nftMarketplace.cancelListing(basicNft.address, TOKEN_ID)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotListed"
                )
            })
            it("reverts if anyone but the owner tries to call", async function () {
                await expect(nftMarketplace.connect(user).cancelListing(basicNft.address, TOKEN_ID)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotOwner"
                )
            })
            it("emits event and removes listing", async function () {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                expect(await nftMarketplace.cancelListing(basicNft.address, TOKEN_ID)).to.emit(
                    "ItemCanceled"
                )
                const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID)
                assert(listing.price.toString() == "0")
            })
        })
        describe("buyItem", function () {
            it("reverts if the item isnt listed", async function () {
                await expect(nftMarketplace.buyItem(basicNft.address, TOKEN_ID)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotListed"
                )
            })
            it("reverts if the price isnt met", async function () {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                let overrides = {
                    value: ethers.utils.parseEther('0.05')
                }
                await expect(nftMarketplace.connect(user).buyItem(basicNft.address, TOKEN_ID, overrides)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__PriceNotMet"
                )
            })
            it("transfers the nft to the buyer and updates internal proceeds record", async function () {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                nftMarketplace = nftMarketplaceContract.connect(user)
                expect(
                    await nftMarketplace.buyItem(basicNft.address, TOKEN_ID, { value: PRICE })
                ).to.emit("ItemBought")
                const newOwner = await basicNft.ownerOf(TOKEN_ID)
                const deployerProceeds = await nftMarketplace.getProceeds(deployer.address)
                assert(newOwner.toString() == user.address)
                assert(deployerProceeds.toString() == PRICE.toString())
            })
        })
        describe("updateListing", function () {
            it("must be owner and listed", async function () {
                await expect(nftMarketplace.updateListing(basicNft.address, TOKEN_ID, PRICE)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotListed"
                )
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                await expect(nftMarketplace.connect(user).updateListing(basicNft.address, TOKEN_ID, PRICE)).to.be.revertedWithCustomError(
                    nftMarketplace,
                    "NftMarketplace__NotOwner"
                )
            })
            it("updates the price of the item", async function () {
                const updatedPrice = ethers.utils.parseEther("0.2")
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                expect(
                    await nftMarketplace.updateListing(basicNft.address, TOKEN_ID, updatedPrice)
                ).to.emit("ItemListed")
                const listing = await nftMarketplace.getListing(basicNft.address, TOKEN_ID)
                assert(listing.price.toString() == updatedPrice.toString())
            })
        })
        describe("withdrawProceeds", function () {
            it("doesn't allow 0 proceed withdrawls", async function () {
                await expect(nftMarketplace.withdrawProceeds()).to.be.revertedWithCustomError(nftMarketplace, "NftMarketplace__NotProceeds")
            })
            it("withdraws proceeds", async function () {
                await nftMarketplace.listItem(basicNft.address, TOKEN_ID, PRICE)
                nftMarketplace = nftMarketplaceContract.connect(user)
                await nftMarketplace.buyItem(basicNft.address, TOKEN_ID, { value: PRICE })
                nftMarketplace = nftMarketplaceContract.connect(deployer)

                const deployerProceedsBefore = await nftMarketplace.getProceeds(deployer.address)
                const deployerBalanceBefore = await deployer.getBalance()
                const txResponse = await nftMarketplace.withdrawProceeds()
                const transactionReceipt = await txResponse.wait(1)
                const { gasUsed, effectiveGasPrice } = transactionReceipt
                const gasCost = gasUsed.mul(effectiveGasPrice)
                const deployerBalanceAfter = await deployer.getBalance()

                assert(
                    deployerBalanceAfter.add(gasCost).toString() ==
                        deployerProceedsBefore.add(deployerBalanceBefore).toString()
                )
            })
        })
    })